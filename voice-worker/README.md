# Clinic Voice Agent (LiveKit + Groq + ElevenLabs)

1. `pip install -r requirements.txt`
2. `cp .env.example .env` aur keys bharo (`GROQ_API_KEY`, `ELEVEN_API_KEY`, `LIVEKIT_*`)
3. Terminal mein test: `python agent.py console`
4. Worker chalana ho: `python agent.py dev`

Logs mein har turn ki latency (STT, LLM, TTS) print hoti hai.
