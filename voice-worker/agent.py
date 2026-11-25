"""
Clinic voice calling agent (LiveKit Agents + Groq + ElevenLabs).

Run locally in terminal:   python agent.py console
Run as worker:             python agent.py dev
"""
import logging
import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    MetricsCollectedEvent,
    RunContext,
    WorkerOptions,
    cli,
    function_tool,
    metrics,
)
from livekit.plugins import elevenlabs, groq, silero

load_dotenv()
logger = logging.getLogger("clinic-agent")

# ---------------------------------------------------------------------------
# 1. CLINIC SETTINGS (fallback when Supabase env vars are not set)
# ---------------------------------------------------------------------------
CLINIC = {
    "agent_name": "Ayesha",
    "clinic_name": "Dental Aesthetic",
    "address": "Gulberg III, Lahore",
    "timings": "10:00 to 19:00",
    "open_hour": 10,
    "close_hour": 19,
    "off_days": "Sunday",
    "default_language": "Urdu",
    "tone": "warm, polite and professional",
    "emergency_number": "1122",
    "timezone": "Asia/Karachi",
    "doctors": [
        {"name": "Dr. Abbas", "speciality": "Dermatologist", "fee": 3000},
        {"name": "Dr. Mukarram", "speciality": "Dermatologist", "fee": 3000},
        {"name": "Dr. Abdullah", "speciality": "Dentist", "fee": 2000},
    ],
    "services": "Teeth whitening, dental check-up, acne treatment, skin care, laser",
    "fallback_action": "say the clinic staff will call the patient back shortly",
    "extra_rules": "",
}

# ---------------------------------------------------------------------------
# 2. SYSTEM PROMPT
# ---------------------------------------------------------------------------
PROMPT_TEMPLATE = """
You are "{agent_name}", the voice assistant of {clinic_name}. You are talking to a
patient on a PHONE CALL. Everything you write is spoken aloud, so write for the ear.

NOW: {now}

# SPEED AND STYLE (most important)
- Keep every reply to ONE short sentence, two at most. Under 20 words per sentence.
- Start with a tiny natural opener when it fits ("Sure.", "Okay.", "جی ضرور۔").
- Never repeat what the caller just said word for word. No long preambles.
- Ask only ONE question at a time, at the very end of your reply.
- No lists, numbering, markdown, emojis, brackets or symbols.
- Say times and numbers the way a person would say them aloud.
- Tone: {tone}. If the patient sounds worried or in pain, show a little care first.

# LANGUAGE
- Default language: {default_language}.
- Reply in the same language the caller uses. Stay in that language until the
  caller changes it. Do NOT switch language by yourself.
- When replying in Urdu, write in Urdu script, in simple everyday spoken Urdu.
  English words like appointment, doctor, whitening, acne are normal; keep them.
- Speech-to-text is sometimes wrong. If a word looks odd, use common sense about
  what the caller most likely meant. If it still makes no sense, ask once politely.

# CLINIC INFORMATION (trust only this)
- Clinic: {clinic_name}
- Address: {address}
- Timings: {timings}
- Closed on: {off_days}
- Doctors and fees:
{doctors}
- Services: {services}

# YOUR JOB
Book, change or cancel appointments, share doctor timings, fees and address, and
answer simple clinic questions.

# BOOKING FLOW
Collect these, one at a time, in this order, skipping anything already known:
1) Patient name  2) Phone number  3) Doctor (or the problem, then suggest the
right doctor)  4) Day and time.
Rules:
- NEVER ask for something the caller has already told you in this call.
- After you get the name, say a short thanks and go straight to the next missing
  item. Never ask "how can I help you" again once the caller has said what they want.
- Read the phone number back in small groups and ask for a yes.
- Before booking, confirm everything in ONE sentence: doctor, day, time, name.
  Only after the caller says yes, call book_appointment.
- If the requested time is after closing or taken, offer the nearest free time.
- Offer the WhatsApp confirmation only AFTER a successful booking.

# TOOLS (important)
- Before using a tool, say only "One moment." Then call the tool.
- check_availability: use it before offering a time.
- book_appointment: use it only after the caller has confirmed.
- send_whatsapp_confirmation: use it only if the caller says yes.
- Only say something is done ("booked", "sent") if the tool returned success.
  If a tool fails, say: "I'm sorry, I couldn't complete that. Our staff will confirm
  with you shortly."

# IF THE CALLER WANTS TO SPEAK TO THE DOCTOR
Say once: "Doctor se direct baat abhi possible nahi, lekin main consultation book
kar deti hoon." (in the caller's language) and continue booking. If they insist,
{fallback_action}.

# EMERGENCY
If the caller mentions chest pain, trouble breathing, fainting, heavy bleeding, an
accident or danger to life, say immediately: "This sounds like an emergency. Please
go to the nearest hospital or call {emergency_number} right now." Do not talk about
appointments in that case.

# LIMITS
- You are not a doctor. Never diagnose or suggest medicine or doses. Say: "The
  doctor can guide you better, I can book your appointment."
- If you don't know something, say so and offer staff follow-up. Never guess.
- Never repeat your previous reply word for word.
- Never ask the same question more than twice. If still stuck, {fallback_action}.
- If asked, you are an AI assistant. Do not lie about it, but stay friendly.
- Keep patient information private.
{extra_rules}

# EXAMPLES
Caller: How much is the fee?
You: It's two thousand rupees for Dr. Abdullah. Shall I book you?

Caller: I want whitening.
You: Sure, Dr. Abdullah handles that. What's your name?

Caller: Talha.
You: Thanks, Talha. What's your phone number?

Caller: مجھے کل کا ٹائم چاہیے
You: جی ضرور، کل کس وقت آنا پسند کریں گے؟
""".strip()


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"[\s()-]", "", raw or "")
    if re.fullmatch(r"\+[1-9]\d{7,14}", digits):
        return digits
    if re.fullmatch(r"03\d{9}", digits):
        return f"+92{digits[1:]}"
    if re.fullmatch(r"923\d{9}", digits):
        return f"+{digits}"
    return raw.strip()


def build_prompt(cfg: dict) -> str:
    tz = ZoneInfo(cfg["timezone"])
    now = datetime.now(tz).strftime("%A, %d %B %Y, %I:%M %p")
    doctors = "\n".join(
        f"  - {d['name']}, {d['speciality']}, fee {d['fee']} rupees" for d in cfg["doctors"]
    )
    return PROMPT_TEMPLATE.format(
        agent_name=cfg["agent_name"],
        clinic_name=cfg["clinic_name"],
        address=cfg["address"],
        timings=cfg["timings"],
        off_days=cfg["off_days"],
        doctors=doctors,
        services=cfg["services"],
        default_language=cfg["default_language"],
        tone=cfg["tone"],
        emergency_number=cfg["emergency_number"],
        fallback_action=cfg["fallback_action"],
        extra_rules=cfg["extra_rules"],
        now=now,
    )


# ---------------------------------------------------------------------------
# 3. TOOLS (in-memory demo + optional Supabase & Meta WhatsApp Cloud API)
# ---------------------------------------------------------------------------
BOOKINGS: list[dict] = []


class ClinicAgent(Agent):
    def __init__(self, cfg: dict):
        super().__init__(instructions=build_prompt(cfg))
        self.cfg = cfg

    def _is_taken(self, doctor: str, date: str, time: str) -> bool:
        return any(
            b["doctor"].lower() == doctor.lower() and b["date"] == date and b["time"] == time
            for b in BOOKINGS
        )

    def _within_hours(self, time: str) -> bool:
        try:
            hour = int(time.split(":")[0])
        except ValueError:
            return False
        return self.cfg["open_hour"] <= hour < self.cfg["close_hour"]

    @function_tool
    async def check_availability(
        self, context: RunContext, doctor: str, date: str, time: str
    ) -> str:
        """Check if a doctor is free at a given time.

        Args:
            doctor: Doctor's name, e.g. "Dr. Abdullah".
            date: Date in YYYY-MM-DD format.
            time: Time in 24-hour HH:MM format, e.g. "18:00".
        """
        if not self._within_hours(time):
            return f"Not available. Clinic hours are {self.cfg['timings']}."
        if self._is_taken(doctor, date, time):
            return "That slot is already taken. Offer another time."
        return "Available."

    @function_tool
    async def book_appointment(
        self,
        context: RunContext,
        name: str,
        phone: str,
        doctor: str,
        date: str,
        time: str,
        reason: str = "",
    ) -> str:
        """Book an appointment AFTER the caller has confirmed all details."""
        if not self._within_hours(time):
            return f"Failed: outside clinic hours ({self.cfg['timings']})."
        if self._is_taken(doctor, date, time):
            return "Failed: slot already taken."

        norm_phone = normalize_phone(phone)
        booking = {
            "name": name,
            "phone": norm_phone,
            "doctor": doctor,
            "date": date,
            "time": time,
            "reason": reason,
        }
        BOOKINGS.append(booking)

        supabase_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        agent_id = os.getenv("VOXA_AGENT_ID")
        user_id = os.getenv("VOXA_USER_ID")
        if supabase_url and supabase_key and agent_id and user_id:
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    await client.post(
                        f"{supabase_url.rstrip('/')}/rest/v1/appointments",
                        headers={
                            "apikey": supabase_key,
                            "Authorization": f"Bearer {supabase_key}",
                            "Content-Type": "application/json",
                            "Prefer": "return=minimal",
                        },
                        json={
                            "user_id": user_id,
                            "agent_id": agent_id,
                            "customer_name": name,
                            "customer_phone": norm_phone,
                            "requested_doctor": doctor,
                            "requested_time": f"{date} {time}",
                            "patient_concern": reason or "Consultation",
                            "service": "Clinic consultation",
                            "status": "requested",
                            "whatsapp_consent": True,
                        },
                    )
            except Exception as exc:
                logger.warning("Supabase save failed (kept in memory): %s", exc)

        logger.info("BOOKED: %s", booking)
        return "Success: appointment booked."

    @function_tool
    async def send_whatsapp_confirmation(
        self, context: RunContext, phone: str, message: str
    ) -> str:
        """Send a WhatsApp confirmation after a successful booking."""
        if os.getenv("WHATSAPP_ENABLED", "false").lower() != "true":
            return "Failed: WhatsApp is not connected. Tell the caller staff will confirm."

        token = os.getenv("META_ACCESS_TOKEN")
        phone_id = os.getenv("META_PHONE_NUMBER_ID")
        version = os.getenv("META_GRAPH_API_VERSION", "v21.0")
        norm_phone = normalize_phone(phone).lstrip("+")
        if not token or not phone_id or not norm_phone:
            return "Failed: WhatsApp API credentials missing."

        try:
            async with httpx.AsyncClient(timeout=12) as client:
                res = await client.post(
                    f"https://graph.facebook.com/{version}/{phone_id}/messages",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "messaging_product": "whatsapp",
                        "to": norm_phone,
                        "type": "text",
                        "text": {"body": message},
                    },
                )
                if not res.is_success:
                    logger.warning("WhatsApp API error %s: %s", res.status_code, res.text)
                    return "Failed: WhatsApp delivery rejected. Staff will confirm."
        except Exception as exc:
            logger.warning("WhatsApp send failed: %s", exc)
            return "Failed: WhatsApp network error. Staff will confirm."

        logger.info("WHATSAPP SENT to %s", norm_phone)
        return "Success: confirmation sent."


# ---------------------------------------------------------------------------
# 4. VOICE PIPELINE (STT -> LLM -> TTS, low latency settings)
# ---------------------------------------------------------------------------
def build_tts():
    return elevenlabs.TTS(
        model=os.getenv("TTS_MODEL", "eleven_flash_v2_5"),
        voice_id=os.getenv("TTS_VOICE_ID", ""),
    )


async def entrypoint(ctx: JobContext):
    await ctx.connect()

    doctor_names = ", ".join(d["name"] for d in CLINIC["doctors"])
    session = AgentSession(
        stt=groq.STT(
            model="whisper-large-v3-turbo",
            language=os.getenv("STT_LANGUAGE", "ur"),
            prompt=f"{CLINIC['clinic_name']}, appointment, whitening, acne, {doctor_names}, WhatsApp",
        ),
        llm=groq.LLM(
            model=os.getenv("LLM_MODEL", "qwen/qwen3.8-27b"),
            temperature=0.6,
        ),
        tts=build_tts(),
        vad=silero.VAD.load(min_silence_duration=0.45),
        min_endpointing_delay=0.4,
        allow_interruptions=True,
        preemptive_generation=True,
    )

    @session.on("metrics_collected")
    def _on_metrics(ev: MetricsCollectedEvent):
        metrics.log_metrics(ev.metrics)

    await session.start(agent=ClinicAgent(CLINIC), room=ctx.room)

    await session.generate_reply(
        instructions=(
            f"Greet the caller in one short sentence: 'Hi, I'm {CLINIC['agent_name']} "
            f"from {CLINIC['clinic_name']}. How can I help you?'"
        )
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
