import { NextResponse } from 'next/server';
import { apiErrorResponse, requireApiUser, ApiError } from '@/lib/api-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { loadClinicDirectory } from '@/lib/clinic-directory';

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

    let ownerUserId = '';
    if (typeof token === 'string' && token) {
      const { data, error } = await supabaseAdmin
        .from('agents')
        .select('id, user_id')
        .eq('share_token', token)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiError('Call not found', 404);
      ownerUserId = data.user_id;
    } else if (typeof agentId === 'string' && agentId) {
      const user = await requireApiUser();
      const { data, error } = await supabaseAdmin
        .from('agents')
        .select('id, user_id')
        .eq('id', agentId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiError('Agent not found', 404);
      ownerUserId = data.user_id;
    } else {
      throw new ApiError('Missing token or agent_id', 422);
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const rate = checkRateLimit(`stt:${ip}:${String(token ?? agentId)}`, 60, 60000);
    if (!rate.allowed) throw new ApiError('Too many transcription requests.', 429);

    const directory = await loadClinicDirectory(ownerUserId);
    const doctorNames = directory.doctors.map((d) => d.name).join(', ');
    const clinicName = directory.clinic?.clinic_name || 'Clinic';
    const vocabPrompt = [
      clinicName,
      doctorNames ? `Doctors: ${doctorNames}` : '',
      'whitening, acne, appointment, consultation, WhatsApp, Dr., 0300, timings, fees',
    ]
      .filter(Boolean)
      .join('. ');

    // Explicitly set language (default "ur" unless caller is in English) — never auto-detect
    const langCode = typeof language === 'string' && language.startsWith('en') ? 'en' : 'ur';

    const groqForm = new FormData();
    groqForm.append('file', audio, 'speech.webm');
    groqForm.append('model', process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo');
    groqForm.append('language', langCode);
    groqForm.append('prompt', vocabPrompt.slice(0, 800));

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
    const text = (result.text ?? '').trim();
    console.info('[STT]', { lang: langCode, text });
    return NextResponse.json({ text, language: langCode });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
