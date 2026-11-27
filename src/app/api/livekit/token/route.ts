import { NextResponse } from 'next/server';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { z } from 'zod';
import { apiErrorResponse, requireApiUser, ApiError } from '@/lib/api-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';

const tokenRequestSchema = z
  .object({
    token: z.string().uuid().optional(),
    agent_id: z.string().uuid().optional(),
  })
  .refine((data) => Boolean(data.token || data.agent_id), {
    message: 'Either token or agent_id is required',
  });

export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';
    const rate = checkRateLimit(`livekit-token:${ip}`, 20, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many token requests. Please wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('Invalid JSON request body', 400);
    }

    const parsed = tokenRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0]?.message ?? 'Invalid request body', 422);
    }

    let resolvedAgentId = '';
    if (parsed.data.token) {
      const { data: agent, error } = await supabaseAdmin
        .from('agents')
        .select('id')
        .eq('share_token', parsed.data.token)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      if (!agent) throw new ApiError('Call not found', 404);
      resolvedAgentId = agent.id;
    } else if (parsed.data.agent_id) {
      const user = await requireApiUser();
      const { data: agent, error } = await supabaseAdmin
        .from('agents')
        .select('id')
        .eq('id', parsed.data.agent_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (!agent) throw new ApiError('Agent not found', 404);
      resolvedAgentId = agent.id;
    }

    const serverUrl = process.env.LIVEKIT_URL?.trim();
    const apiKey = process.env.LIVEKIT_API_KEY?.trim();
    const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

    if (!serverUrl || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'LiveKit server credentials are not configured.' },
        { status: 503 }
      );
    }

    const roomName = `clinic-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const identity = `caller-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const metadata = JSON.stringify({ agent_id: resolvedAgentId });

    try {
      const httpUrl = serverUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
      const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
      await roomService.createRoom({
        name: roomName,
        metadata,
        emptyTimeout: 600,
      });
    } catch (err) {
      console.warn('LiveKit createRoom metadata warning:', err instanceof Error ? err.message : 'Unknown');
    }

    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity,
      metadata,
      ttl: '10m',
    });

    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const jwt = await accessToken.toJwt();
    return NextResponse.json({ serverUrl, roomName, token: jwt });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function methodNotAllowed() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
