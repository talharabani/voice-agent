import { NextResponse } from 'next/server'
import { createHmac } from 'crypto'

import { safeEqual } from '@/lib/security'

/**
 * Meta (WhatsApp Cloud API) webhook.
 *
 * GET  — subscription handshake (hub.verify_token check).
 * POST — incoming messages, verified against X-Hub-Signature-256
 *        using META_APP_SECRET, then forwarded to the n8n workflow.
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')
  const expected = process.env.META_VERIFY_TOKEN

  if (mode === 'subscribe' && token && expected && safeEqual(token, expected)) {
    return new Response(challenge, { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

export async function POST(request: Request) {
  const rawBody = await request.text()

  // Verify the payload actually came from Meta.
  const appSecret = process.env.META_APP_SECRET
  if (appSecret) {
    const signature = request.headers.get('x-hub-signature-256') ?? ''
    const expected =
      'sha256=' + createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
    if (!signature || !safeEqual(signature, expected)) {
      return new Response('Invalid signature', { status: 401 })
    }
  } else {
    console.warn(
      'META_APP_SECRET is not set — WhatsApp webhook signature NOT verified. ' +
        'Set it before going to production.'
    )
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const webhookBase = process.env.N8N_WEBHOOK_BASE
  if (webhookBase) {
    try {
      await fetch(`${webhookBase}/whatsapp-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (err) {
      console.error('n8n forward failed:', err)
    }
  }

  // Always 200 so Meta doesn't retry-storm us.
  return NextResponse.json({ status: 'ok' })
}
