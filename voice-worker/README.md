# Clinic Voice Agent (LiveKit)

1. `pip install -r requirements.txt`
2. `cp .env.example .env` aur keys bharo (`DEEPGRAM_API_KEY`, `GROQ_API_KEY`, `ELEVEN_API_KEY`, `GOOGLE_API_KEY`, `LIVEKIT_*`)
3. Pipeline agent (Deepgram + Groq + ElevenLabs): `python agent.py console`
4. Gemini Live speech-to-speech agent: `python gemini_live_agent.py console`
5. Worker chalana ho: `python agent.py dev` (ya `python gemini_live_agent.py dev`)

Logs mein har turn ki latency (`TURN LATENCY | STT/EOU | LLM TTFT | TTS TTFB | Total`) print hoti hai.
