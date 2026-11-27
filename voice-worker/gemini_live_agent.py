"""
Clinic voice calling agent using Google Gemini Live API (speech-to-speech).

Run locally in terminal:   python gemini_live_agent.py console
Run as worker:             python gemini_live_agent.py dev
"""
import logging
import os

from dotenv import load_dotenv
from livekit.agents import (
    AgentSession,
    JobContext,
    MetricsCollectedEvent,
    WorkerOptions,
    cli,
    metrics,
)
from livekit.plugins import google

from agent import CLINIC, ClinicAgent, DegradedClinicAgent, build_prompt, load_clinic_for_room  # noqa: F401 (reused from agent.py)

load_dotenv()
logger = logging.getLogger("clinic-gemini-live")


async def entrypoint(ctx: JobContext):
    await ctx.connect()
    clinic_cfg = await load_clinic_for_room(ctx)

    session = AgentSession(
        llm=google.realtime.RealtimeModel(
            model=os.getenv("GEMINI_LIVE_MODEL", "gemini-3.8-live"),
            voice=os.getenv("GEMINI_VOICE", "Puck"),
            api_key=os.getenv("GOOGLE_API_KEY"),
            api_version=os.getenv("GEMINI_API_VERSION") or "v1beta",
            temperature=0.6,
        ),
        allow_interruptions=True,
    )

    @session.on("metrics_collected")
    def _on_metrics(ev: MetricsCollectedEvent):
        metrics.log_metrics(ev.metrics)

    if clinic_cfg is None:
        await session.start(agent=DegradedClinicAgent(), room=ctx.room)
        await session.generate_reply(
            instructions="Greet briefly, apologize that our clinic system is having a technical issue right now, and say staff will call back shortly."
        )
        return

    await session.start(agent=ClinicAgent(clinic_cfg), room=ctx.room)

    await session.generate_reply(
        instructions=(
            f"Greet the caller in one short sentence: 'Hi, I'm {clinic_cfg['agent_name']} "
            f"from {clinic_cfg['clinic_name']}. How can I help you?'"
        )
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
