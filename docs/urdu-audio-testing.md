# Urdu audio on the testing laptop

The browser-only path could generate the correct reply but remain silent when no Urdu voice was installed or speech synthesis failed. Speech errors were previously treated as a successful completion. They are now explicit, and speaking state begins on actual playback rather than text arrival.

## Audio provider

With the workspace owner's approval, generated call text is sent to Microsoft's online speech service through the open-source [edge-tts](https://github.com/rany2/edge-tts) testing client. Text can contain patient/appointment details. No call text or audio is stored by the local bridge. This is an unofficial no-key client, not an Azure production service or uptime guarantee. Use this data flow only in a deployment where it is authorized.

Urdu uses `ur-PK-UzmaNeural` (female) and `ur-PK-AsadNeural` (male), listed in [Microsoft's voice documentation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support). English and Hindi have matching voices. Shahmukhi Punjabi currently uses the Urdu voice as a pronunciation fallback, not a dedicated Punjabi voice. Youthful is a pitch/rate style, not a child recording.

## Start after restarting the laptop

From the repository root in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-voice-laptop.ps1
```

This creates a local Python environment under ignored `.claude/`, installs the pinned speech client when needed, starts Ollama and a loopback voice bridge on port 11435, and connects ngrok. It reuses the previous voice tunnel URL when possible. It will not stop an unrelated tunnel/service. Keep the laptop, internet, helper and tunnel running for Vercel testing.

The public `OLLAMA_BASE_URL` in Vercel should point to the printed tunnel URL. It now forwards both `/api/*` requests to Ollama and `/voxa/tts` to the approved online speech client. Existing testing URLs can stay the same. For local Next.js testing set `VOICE_BRIDGE_URL=http://127.0.0.1:11435`; Vercel normally falls back to `OLLAMA_BASE_URL` and does not need an additional variable.

The application speech endpoint validates the public call capability or authenticated agent ownership and rate-limits requests. It does not forward share tokens or service keys to the speech bridge. Calls to ngrok include the interstitial bypass header so an HTML warning cannot be mistaken for model/audio output.

## Playback and design

Reply sentences preload their audio while the preceding sentence plays. The audio element is primed during the user's call/preview gesture. Abort/hangup stops playback and releases blob URLs. When online speech fails, only a device voice that actually supports the reply language is eligible as a fallback; an English voice is not silently substituted for Urdu. Speaker failures display an error and an Enable audio / replay control.

The orb uses rotating aurora light, rays, flowing highlights and particles. Listening responds to the microphone level; speaking/preview lights intensify on actual playback. Reduced-motion preferences disable animation. The visual does not claim to measure the agent's mood.

## Validation

Run `node --test tests/*.test.cjs` and `npm run build`. Verify a real `/api/voice/speech` request returns decodable MP3 audio, not only a text reply. Check male/female Urdu previews and hangup/interrupt handling in Chrome or Edge. Microphone recognition remains the browser speech service and must listen in Urdu for Urdu callers. A generated audio file and browser decode test do not guarantee speech recognition quality for every speaker or device.
