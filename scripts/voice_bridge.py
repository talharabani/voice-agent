"""Loopback Ollama proxy and user-approved Microsoft online speech bridge.

No speech text/audio is stored on disk. Online TTS receives generated call
text; the workspace owner explicitly approved that transfer. The edge-tts
client is an unofficial no-key testing integration, not a production SLA.
"""
import asyncio
from contextlib import aclosing
import aiohttp
from aiohttp import web
import edge_tts

VOICES = {
    "en": ("en-US-JennyNeural", "en-US-GuyNeural"),
    "ur": ("ur-PK-UzmaNeural", "ur-PK-AsadNeural"),
    "hi": ("hi-IN-SwaraNeural", "hi-IN-MadhurNeural"),
    "pa": ("ur-PK-UzmaNeural", "ur-PK-AsadNeural"),
}
STYLES = {
    "warm-female": (False, "+0%", "+0Hz"), "clear-female": (False, "+3%", "+2Hz"),
    "calm-male": (True, "-2%", "+0Hz"), "deep-male": (True, "-3%", "-4Hz"),
    "youthful": (False, "+3%", "+8Hz"), "gentle": (False, "-6%", "+0Hz"),
}
SLOTS = asyncio.Semaphore(3)

async def health(_request):
    return web.json_response({"service": "voxa-local-voice", "speech": True})

async def speak(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid speech request"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "Invalid speech request"}, status=400)
    text, language, style = body.get("text"), body.get("language", "ur"), body.get("style", "warm-female")
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000 or not isinstance(language, str) or not isinstance(style, str) or language not in VOICES or style not in STYLES:
        return web.json_response({"error": "Invalid text, language or voice style"}, status=422)
    male, rate, pitch = STYLES[style]
    voice = VOICES[language][int(male)]
    response = None
    try:
        async with asyncio.timeout(20), SLOTS:
            speech = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, connect_timeout=6, receive_timeout=12)
            async with aclosing(speech.stream()) as chunks:
                first = None
                async for part in chunks:
                    if part["type"] == "audio":
                        first = part["data"]
                        break
                if not first:
                    return web.json_response({"error": "No speech audio received"}, status=502)
                response = web.StreamResponse(headers={"Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Name": voice})
                await response.prepare(request)
                await response.write(first)
                async for part in chunks:
                    if part["type"] == "audio":
                        await response.write(part["data"])
                await response.write_eof()
                return response
    except (ConnectionResetError, asyncio.CancelledError):
        raise
    except Exception:
        if response is not None and response.prepared:
            response.force_close()
            return response
        return web.json_response({"error": "Online voice service is unavailable"}, status=503)

async def proxy(request):
    url = "http://127.0.0.1:11434" + request.path_qs
    async with request.app["http"].request(request.method, url, data=await request.read(), headers={"Content-Type": request.headers.get("Content-Type", "application/json")}) as upstream:
        response = web.StreamResponse(status=upstream.status, headers={"Content-Type": upstream.headers.get("Content-Type", "application/json"), "Cache-Control": "no-store"})
        await response.prepare(request)
        async for chunk in upstream.content.iter_any():
            await response.write(chunk)
        await response.write_eof()
        return response

async def lifecycle(app):
    app["http"] = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=180))
    yield
    await app["http"].close()

def create_app():
    app = web.Application(client_max_size=1_000_000)
    app.cleanup_ctx.append(lifecycle)
    app.router.add_get("/voxa/health", health)
    app.router.add_post("/voxa/tts", speak)
    app.router.add_route("*", "/api/{tail:.*}", proxy)
    return app

if __name__ == "__main__":
    web.run_app(create_app(), host="127.0.0.1", port=11435, access_log=None)
