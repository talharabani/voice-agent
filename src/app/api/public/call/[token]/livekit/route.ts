import { NextResponse } from 'next/server';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { z } from 'zod';
import { apiErrorResponse, ApiError } from '@/lib/api-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { callLimitForPlan, monthStartISO } from '@/lib/plan';

/**
 * POST /api/public/call/[token]/livekit
 *
 * Dedicated, hardened LiveKit token endpoint for public clinic booking links (/call/[token]).
 * - Never accepts an arbitrary agent_id; resolves strictly from the unguessable share_token UUID.
 * - Enforces same-origin (when Origin is present), per-IP and per-token rate limits,
 *   active agent status, and the clinic's monthly plan call limit.
 * - Keeps /api/livekit/token protected behind Clerk for logged-in dashboard calls.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!z.string().uuid().safeParse(token).success) {
      throw new ApiError('Invalid call link.', 404);
    }

    // Same-origin protection for browser requests
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          throw new ApiError('Forbidden origin.', 403);
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError('Invalid request origin.', 403);
      }
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';

    const ipRate = checkRateLimit(`pub-lk-ip:${ip}`, 8, 5 * 60_000);
    if (!ipRate.allowed) {
      return NextResponse.json(
        { error: 'Too many call attempts. Please wait a few minutes and try again.' },
        { status: 429, headers: { 'Retry-After': String(ipRate.retryAfterSeconds) } }
      );
    }

    const tokenRate = checkRateLimit(`pub-lk-tok:${token}`, 30, 5 * 60_000);
    if (!tokenRate.allowed) {
      return NextResponse.json(
        { error: 'This clinic line is busy right now. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(tokenRate.retryAfterSeconds) } }
      );
    }

    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id, user_id, is_active')
      .eq('share_token', token)
      .eq('is_active', true)
      .maybeSingle();

    if (agentError) throw agentError;
    if (!agent) {
      throw new ApiError('This clinic call link is unavailable.', 404);
    }

    // Enforce clinic's monthly plan call quota
    const [ownerRes, usageRes] = await Promise.all([
      supabaseAdmin.from('users').select('plan').eq('id', agent.user_id).maybeSingle(),
      supabaseAdmin
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', agent.user_id)
        .gte('created_at', monthStartISO()),
    ]);

    const limit = callLimitForPlan(ownerRes.data?.plan ?? 'free');
    if ((usageRes.count ?? 0) >= limit) {
      throw new ApiError('This clinic has reached its monthly call limit. Please contact the clinic directly.', 429);
    }

    const serverUrl = process.env.LIVEKIT_URL?.trim();
    const apiKey = process.env.LIVEKIT_API_KEY?.trim();
    const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

    if (!serverUrl || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'Voice service is temporarily unavailable.' },
        { status: 503 }
      );
    }

    const roomName = `clinic-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const identity = `caller-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const metadata = JSON.stringify({ agent_id: agent.id });

    try {
      const httpUrl = serverUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
      const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
      await roomService.createRoom({
        name: roomName,
        metadata,
        emptyTimeout: 180,
      });
    } catch (err) {
      console.warn('Public LiveKit createRoom metadata warning:', err instanceof Error ? err.message : 'Unknown');
    }

    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity,
      metadata,
      ttl: '5m',
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
