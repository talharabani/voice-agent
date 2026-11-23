import { NextResponse } from 'next/server';
import { apiErrorResponse, requireApiUser, ApiError } from '@/lib/api-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY is not configured' }, { status: 501 });
    }

    const formData = await request.formData();
    const audio = formData.get('audio');
    const language = formData.get('language');
    const token = formData.get('token');
    const agentId = formData.get('agent_id');

    if (!(audio instanceof Blob) || audio.size === 0) {
      throw new ApiError('Audio file is required', 422);
    }

    if (typeof token === 'string' && token) {
      const { data, error } = await supabaseAdmin
        .from('agents')
        .select('id')
        .eq('share_token', token)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiError('Call not found', 404);
    } else if (typeof agentId === 'string' && agentId) {
      const user = await requireApiUser();
      const { data, error } = await supabaseAdmin
        .from('agents')
        .select('id')
        .eq('id', agentId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiError('Agent not found', 404);
    } else {
      throw new ApiError('Missing token or agent_id', 422);
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const rate = checkRateLimit(`stt:${ip}:${String(token ?? agentId)}`, 60, 60000);
    if (!rate.allowed) throw new ApiError('Too many transcription requests.', 429);

    const groqForm = new FormData();
    groqForm.append('file', audio, 'speech.webm');
    groqForm.append('model', process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo');
    if (typeof language === 'string' && /^(ur|en|hi|pa)$/.test(language)) {
      groqForm.append('language', language === 'pa' ? 'ur' : language);
    }

    const upstream = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey}` },
      body: groqForm,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: `Whisper STT failed (${upstream.status})` }, { status: 502 });
    }

    const result = (await upstream.json()) as { text?: string };
    return NextResponse.json({ text: (result.text ?? '').trim() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
