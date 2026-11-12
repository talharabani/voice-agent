export async function POST(req: Request) {
  const { callSid, speechResult } = await req.json()

  const params = new URLSearchParams()
  params.set('CallSid', callSid)
  if (speechResult) params.set('SpeechResult', speechResult)

  const webhookBase = process.env.N8N_WEBHOOK_BASE
  if (!webhookBase) {
    return Response.json({ agentText: 'N8N_WEBHOOK_BASE is not configured.' }, { status: 500 })
  }

  let twimlText: string
  try {
    const res = await fetch(`${webhookBase}/phone-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    twimlText = await res.text()
  } catch {
    return Response.json({ agentText: 'Could not reach the n8n webhook.' }, { status: 502 })
  }

  // Extract text from <Say> tag in TwiML response ([\s\S] instead of dotAll /s flag)
  const match = twimlText.match(/<Say[^>]*>([\s\S]*?)<\/Say>/)
  const agentText = match ? match[1].trim() : 'Sorry, something went wrong.'

  return Response.json({ agentText })
}
