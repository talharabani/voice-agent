import { NextResponse } from 'next/server';
import { z } from 'zod';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { apiErrorResponse, requireApiUser, ApiError } from '@/lib/api-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 30;

const schema = z.object({
  text: z.string().trim().min(1).max(2000),
  language: z.enum(['en', 'ur', 'pa', 'hi']),
  style: z.enum(['warm-female', 'clear-female', 'calm-male', 'deep-male', 'youthful', 'gentle']),
  token: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
});

type Style = z.infer<typeof schema>['style'];
type Language = z.infer<typeof schema>['language'];

function edgeVoiceFor(language: Language, style: Style): { voice: string; rate?: string; pitch?: string } {
  const isMale = style === 'calm-male' || style === 'deep-male';
  const prosody =
    style === 'deep-male'
      ? { rate: '+2%', pitch: '-6Hz' }
      : style === 'youthful'
        ? { rate: '+12%', pitch: '+6Hz' }
        : style === 'gentle'
          ? { rate: '+4%', pitch: '+2Hz' }
          : { rate: '+8%' };

  switch (language) {
    case 'ur':
      return { voice: isMale ? 'ur-PK-AsadNeural' : 'ur-PK-UzmaNeural', ...prosody };
    case 'hi':
      return { voice: isMale ? 'hi-IN-MadhurNeural' : 'hi-IN-SwaraNeural', ...prosody };
    case 'pa':
      return { voice: isMale ? 'ur-PK-AsadNeural' : 'pa-IN-GurpreetNeural', ...prosody };
    case 'en':
    default:
      return { voice: isMale ? 'en-US-GuyNeural' : 'en-US-JennyNeural', ...prosody };
  }
}

function synthesizeEdgeTtsStream(text: string, language: Language, style: Style): Promise<ReadableStream<Uint8Array>> {
  const { voice, rate, pitch } = edgeVoiceFor(language, style);
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 8000, synthesisTimeoutMs: 15000 });
  return tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3).then(() => {
    const { audioStream } = tts.toStream(text, { ...(rate ? { rate } : {}), ...(pitch ? { pitch } : {}) });
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          let hasData = false;
          for await (const chunk of audioStream) {
            hasData = true;
            controller.enqueue(Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : new Uint8Array(Buffer.from(chunk)));
          }
          if (!hasData) throw new Error('Empty Edge-TTS audio stream');
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          tts.close();
        }
      },
      cancel() {
        tts.close();
      },
    });
  });
}

async function synthesizeElevenLabs(text: string, signal: AbortSignal): Promise<Response | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5',
    }),
    signal,
  });
  if (!res.ok || !res.body) return null;
  return new Response(res.body, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice-Provider': 'elevenlabs' },
  });
}

async function synthesizeCartesia(text: string, language: Language, signal: AbortSignal): Promise<Response | null> {
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) return null;
  const voiceId = process.env.CARTESIA_VOICE_ID || '694f9389-aac1-45b6-b726-9d9369183238';
  const res = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'Cartesia-Version': '2024-06-10',
    },
    body: JSON.stringify({
      model_id: process.env.CARTESIA_MODEL_ID || 'sonic-multilingual',
      transcript: text,
      voice: { mode: 'id', id: voiceId },
      language: language === 'pa' ? 'ur' : language,
      output_format: { container: 'mp3', bit_rate: 128000, sample_rate: 44100 },
    }),
    signal,
  });
  if (!res.ok || !res.body) return null;
  return new Response(res.body, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice-Provider': 'cartesia' },
  });
}

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError('Invalid speech request', 422);
    const input = parsed.data;

    if (input.token) {
      const { data, error } = await supabaseAdmin.from('agents').select('id').eq('share_token', input.token).eq('is_active', true).maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiError('Call not found', 404);
    } else {
      const user = await requireApiUser();
      const { data, error } = await supabaseAdmin.from('agents').select('id').eq('id', input.agent_id ?? '').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiError('Agent not found', 404);
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const rate = checkRateLimit(`speech:${ip}:${input.token ?? input.agent_id}`, 60, 60000);
    if (!rate.allowed) throw new ApiError('Too many speech requests. Please wait a moment.', 429);

    const timeoutSignal = AbortSignal.any([request.signal, AbortSignal.timeout(23000)]);
    const preferredProvider = (process.env.TTS_PROVIDER || '').toLowerCase();

    if (preferredProvider === 'elevenlabs') {
      const res = await synthesizeElevenLabs(input.text, timeoutSignal);
      if (res) return res;
    } else if (preferredProvider === 'cartesia') {
      const res = await synthesizeCartesia(input.text, input.language, timeoutSignal);
      if (res) return res;
    }

    // Default free cloud neural TTS via Microsoft Edge-TTS (streamed directly)
    try {
      const stream = await synthesizeEdgeTtsStream(input.text, input.language, input.style);
      return new Response(stream, {
        headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice-Provider': 'msedge-tts' },
      });
    } catch {
      // Fallback to optional ElevenLabs / Cartesia if configured
      const eleven = await synthesizeElevenLabs(input.text, timeoutSignal);
      if (eleven) return eleven;
      const cartesia = await synthesizeCartesia(input.text, input.language, timeoutSignal);
      if (cartesia) return cartesia;
    }

    // Legacy local voice bridge fallback if explicitly configured
    const bridgeBase = process.env.VOICE_BRIDGE_URL?.replace(/\/$/, '');
    if (bridgeBase) {
      const upstream = await fetch(`${bridgeBase}/voxa/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ text: input.text, language: input.language, style: input.style }),
        signal: timeoutSignal,
      });
      if (upstream.ok && upstream.body && upstream.headers.get('content-type')?.includes('audio/')) {
        return new Response(upstream.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice-Provider': 'edge-online' } });
      }
    }

    return NextResponse.json({ error: 'Urdu audio service is unavailable right now. Please try again.' }, { status: 503 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
