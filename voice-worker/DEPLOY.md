# Deploying the LiveKit Voice Worker & Next.js Web App

## 1. Deploy the Python Worker on Railway (24/7)

1. Push your repository to GitHub (make sure `voice-worker/.env` is **not** committed).
2. In **Railway**, create a **New Project -> Deploy from GitHub repo**.
3. Set the **Root Directory** to `voice-worker` (Railway will automatically detect `voice-worker/Dockerfile`).
4. Add the environment variables for your chosen `WORKER_ENTRY`:

### Option A: `WORKER_ENTRY=gemini_live_agent.py` (Default — Gemini Live Speech-to-Speech)
| Variable | Value / Notes |
| --- | --- |
| `WORKER_ENTRY` | `gemini_live_agent.py` |
| `LIVEKIT_URL` | `wss://your-project.livekit.cloud` |
| `LIVEKIT_API_KEY` | From LiveKit Cloud |
| `LIVEKIT_API_SECRET` | From LiveKit Cloud |
| `GOOGLE_API_KEY` | From Google AI Studio (`aistudio.google.com`) |
| `GEMINI_LIVE_MODEL` | `gemini-3.8-live` |
| `GEMINI_VOICE` | `Puck` (or another supported Gemini voice) |
| `VOXA_APP_URL` | Your Vercel app URL (e.g. `https://your-app.vercel.app`) |
| `WORKER_API_SECRET` | Same shared secret set in Vercel |
| `ALLOW_DEFAULT_CLINIC` | `false` (set `true` only for local standalone testing) |
| `WHATSAPP_ENABLED` | `false` (until Meta WhatsApp API is wired) |

### Option B: `WORKER_ENTRY=agent.py` (Deepgram STT + Groq LLM + ElevenLabs TTS)
| Variable | Value / Notes |
| --- | --- |
| `WORKER_ENTRY` | `agent.py` |
| `LIVEKIT_URL` | `wss://your-project.livekit.cloud` |
| `LIVEKIT_API_KEY` | From LiveKit Cloud |
| `LIVEKIT_API_SECRET` | From LiveKit Cloud |
| `DEEPGRAM_API_KEY` | From `console.deepgram.com` |
| `GROQ_API_KEY` | From `console.groq.com` |
| `ELEVEN_API_KEY` | From `elevenlabs.io` |
| `STT_LANGUAGE` | `ur` or `en` |
| `VOXA_APP_URL` | Your Vercel app URL (e.g. `https://your-app.vercel.app`) |
| `WORKER_API_SECRET` | Same shared secret set in Vercel |
| `ALLOW_DEFAULT_CLINIC` | `false` (set `true` only for local standalone testing) |
| `WHATSAPP_ENABLED` | `false` (until Meta WhatsApp API is wired) |

5. Deploy! Railway streams stdout logs directly (`PYTHONUNBUFFERED=1`) and sends `SIGTERM` for graceful shutdown via `exec python ... start`.

### Alternative Hosts (Render / Fly.io)
- **Render**: Create a **Background Worker** pointing to `voice-worker/Dockerfile` and set the same env vars above.
- **Fly.io**: Run `fly launch --no-deploy` inside `voice-worker/`, set secrets with `fly secrets set LIVEKIT_URL=...`, and `fly deploy`.

---

## 2. Vercel Environment Variables (Next.js Web App)

In **Vercel -> Project Settings -> Environment Variables**, add:
- `LIVEKIT_URL` = `wss://your-project.livekit.cloud`
- `LIVEKIT_API_KEY` = (your LiveKit API key — server-only, no `NEXT_PUBLIC_` prefix)
- `LIVEKIT_API_SECRET` = (your LiveKit API secret — server-only, no `NEXT_PUBLIC_` prefix)
- `WORKER_API_SECRET` = (shared secret matching the Railway worker)
- `NEXT_PUBLIC_VOICE_MODE` = `livekit` (set to `legacy` anytime to fall back to Groq + Edge-TTS)

> **Important:** After adding or changing environment variables in Vercel, go to **Deployments -> ⋯ -> Redeploy** so the live build picks them up.
