import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiErrorResponse, requireApiUser, ApiError } from '@/lib/api-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 30;
const schema = z.object({
  text: z.string().trim().min(1).max(2000), language: z.enum(['en', 'ur', 'pa', 'hi']),
  style: z.enum(['warm-female', 'clear-female', 'calm-male', 'deep-male', 'youthful', 'gentle']),
  token: z.string().uuid().optional(), agent_id: z.string().uuid().optional(),
});
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
    const base = (process.env.VOICE_BRIDGE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11435').replace(/\/$/, '');
    const upstream = await fetch(`${base}/voxa/tts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ text: input.text, language: input.language, style: input.style }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(23000)]),
    });
    if (!upstream.ok || !upstream.body || !upstream.headers.get('content-type')?.includes('audio/')) {
      return NextResponse.json({ error: 'Urdu audio service is unavailable. Keep the laptop voice helper and tunnel running.' }, { status: 503 });
    }
    return new Response(upstream.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice-Provider': 'edge-online' } });
  } catch (error) { return apiErrorResponse(error); }
}
