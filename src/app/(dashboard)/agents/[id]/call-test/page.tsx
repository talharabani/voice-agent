'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Mic, Phone, PhoneOff, Send, Volume2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { PageHeader } from '@/components/dashboard/page-header'
import { Waveform } from '@/components/voice/waveform'

/* ------------------------------------------------------------------ */
/* Minimal Web Speech API typings (not part of TS dom lib everywhere) */
/* ------------------------------------------------------------------ */

interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/* ------------------------------------------------------------------ */

type Turn = { speaker: 'caller' | 'agent'; text: string }
type CallStatus = 'idle' | 'thinking' | 'speaking' | 'listening'

const STATUS_LABEL: Record<CallStatus, string> = {
  idle: 'No active call',
  thinking: 'Agent is thinking…',
  speaking: 'Agent is speaking — tap Interrupt to talk',
  listening: 'Listening… speak now',
}

export default function CallTestPage() {
  const { id: agentId } = useParams<{ id: string }>()

  const [agentName, setAgentName] = useState<string>('AI agent')
  const [callActive, setCallActive] = useState(false)
  const [status, setStatus] = useState<CallStatus>('idle')
  const [turns, setTurns] = useState<Turn[]>([])
  const [interim, setInterim] = useState('')
  const [input, setInput] = useState('')
  const [micSupported, setMicSupported] = useState(true)
  const [micBlocked, setMicBlocked] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  const historyRef = useRef<Turn[]>([])
  const activeRef = useRef(false)
  const statusRef = useRef<CallStatus>('idle')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const startedAtRef = useRef<number>(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMicSupported(getRecognitionCtor() !== null)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/agents/${agentId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled && data?.agent?.name) setAgentName(data.agent.name)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [agentId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, interim, status])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false
      recognitionRef.current?.abort()
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
    }
  }, [])

  function setStatusBoth(s: CallStatus) {
    statusRef.current = s
    setStatus(s)
  }

  function pushTurn(turn: Turn) {
    historyRef.current = [...historyRef.current, turn]
    setTurns(historyRef.current)
  }

  /* ----------------------------- TTS ------------------------------ */

  function pickVoice(): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis.getVoices()
    if (voices.length === 0) return null
    const en = voices.filter(v => v.lang.toLowerCase().startsWith('en'))
    const preferred =
      en.find(v => /natural|neural|online/i.test(v.name)) ??
      en.find(v => /google/i.test(v.name)) ??
      en[0]
    return preferred ?? voices[0]
  }

  const speak = useCallback((text: string): Promise<void> => {
    return new Promise(resolve => {
      if (typeof window === 'undefined' || !window.speechSynthesis) return resolve()

      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      const voice = pickVoice()
      if (voice) utterance.voice = voice
      utterance.rate = 1

      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(guard)
        resolve()
      }
      // Guard: some browsers occasionally never fire onend
      const guard = setTimeout(finish, Math.max(4000, text.length * 120))

      utterance.onend = finish
      utterance.onerror = finish
      window.speechSynthesis.speak(utterance)
    })
  }, [])

  /* ----------------------------- STT ------------------------------ */

  const startListening = useCallback(() => {
    if (!activeRef.current) return
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      // No mic support: stay in call, user can type instead.
      setStatusBoth('listening')
      return
    }

    recognitionRef.current?.abort()
    const recognition = new Ctor()
    recognitionRef.current = recognition
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = true

    let finalText = ''

    recognition.onresult = e => {
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        if (result.isFinal) finalText += result[0].transcript
        else interimText += result[0].transcript
      }
      setInterim(interimText)
      if (finalText.trim()) {
        recognition.stop()
      }
    }

    recognition.onend = () => {
      setInterim('')
      if (!activeRef.current) return
      const text = finalText.trim()
      if (text) {
        void handleCallerUtterance(text)
      } else if (statusRef.current === 'listening') {
        // Silence timeout — keep listening.
        try {
          recognition.start()
        } catch {
          startListening()
        }
      }
    }

    recognition.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setMicBlocked(true)
        setErrorMsg(
          'Microphone is blocked or speech recognition is unavailable in this browser. You can still type below — or open this page in Chrome/Edge and allow the mic.'
        )
      }
      // 'no-speech' and 'aborted' are handled by onend restart logic.
    }

    setStatusBoth('listening')
    try {
      recognition.start()
    } catch {
      /* already started */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------- Conversation ------------------------- */

  const converse = useCallback(
    async (history: Turn[]): Promise<string | null> => {
      try {
        const res = await fetch('/api/voice/converse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agentId, history }),
        })
        const data = await res.json()
        if (!res.ok) {
          setErrorMsg(data.error ?? 'Something went wrong.')
          return null
        }
        setErrorMsg(null)
        return data.reply as string
      } catch {
        setErrorMsg('Could not reach the server.')
        return null
      }
    },
    [agentId]
  )

  const handleCallerUtterance = useCallback(
    async (text: string) => {
      if (!activeRef.current) return
      recognitionRef.current?.abort()
      setInterim('')
      pushTurn({ speaker: 'caller', text })
      setStatusBoth('thinking')

      const reply = await converse(historyRef.current)
      if (!activeRef.current) return

      if (reply) {
        pushTurn({ speaker: 'agent', text: reply })
        setStatusBoth('speaking')
        await speak(reply)
        if (!activeRef.current) return
      }
      startListening()
    },
    [converse, speak, startListening]
  )

  /* -------------------------- Call control ------------------------ */

  async function startCall() {
    setErrorMsg(null)
    setSavedNote(null)
    historyRef.current = []
    setTurns([])
    activeRef.current = true
    setCallActive(true)
    startedAtRef.current = Date.now()
    setStatusBoth('thinking')

    const greeting = await converse([])
    if (!activeRef.current) return

    if (greeting) {
      pushTurn({ speaker: 'agent', text: greeting })
      setStatusBoth('speaking')
      await speak(greeting)
      if (!activeRef.current) return
    }
    startListening()
  }

  async function endCall() {
    activeRef.current = false
    setCallActive(false)
    setStatusBoth('idle')
    setInterim('')
    recognitionRef.current?.abort()
    window.speechSynthesis?.cancel()

    const transcript = historyRef.current
    if (transcript.length > 0) {
      const duration = Math.round((Date.now() - startedAtRef.current) / 1000)
      try {
        const res = await fetch('/api/voice/test-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: agentId,
            transcript,
            duration_seconds: duration,
          }),
        })
        if (res.ok) {
          setSavedNote('Call saved — see Conversations for the transcript and analysis.')
        }
      } catch {
        /* saving is best-effort */
      }
    }
  }

  function interruptAgent() {
    if (statusRef.current !== 'speaking') return
    window.speechSynthesis?.cancel()
    startListening()
  }

  function handleSendText() {
    const text = input.trim()
    if (!text || !callActive || statusRef.current === 'thinking') return
    setInput('')
    window.speechSynthesis?.cancel()
    void handleCallerUtterance(text)
  }

  /* ------------------------------ UI ------------------------------ */

  const busy = status === 'thinking'

  return (
    <div>
      <PageHeader
        title="Call tester"
        description={`Have a live voice conversation with ${agentName}. Speak into your mic — or type.`}
      />

      <div className="max-w-2xl">
        <Card className="border-brand-border bg-brand-surface">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <div className="flex items-center gap-3">
              <span
                className={`size-2 rounded-full ${callActive ? 'bg-brand-teal animate-pulse' : 'bg-brand-muted'}`}
              />
              <span className="text-sm font-medium text-brand-text">
                {STATUS_LABEL[status]}
              </span>
              {status === 'speaking' && <Waveform active />}
              {status === 'listening' && !micBlocked && micSupported && (
                <Mic className="size-4 animate-pulse text-brand-teal" />
              )}
            </div>

            <div className="flex items-center gap-2">
              {callActive && status === 'speaking' && (
                <Button variant="outline" size="sm" onClick={interruptAgent}>
                  <Volume2 className="size-4" />
                  Interrupt
                </Button>
              )}
              {!callActive ? (
                <Button onClick={startCall}>
                  <Phone className="size-4" />
                  Start call
                </Button>
              ) : (
                <Button variant="destructive" onClick={endCall}>
                  <PhoneOff className="size-4" />
                  End call
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            {!micSupported && (
              <p className="rounded-md border border-brand-border bg-brand-bg p-3 text-xs text-brand-muted">
                This browser doesn&apos;t support speech recognition. Use Chrome or Edge
                for the full voice experience — typing still works below.
              </p>
            )}

            {errorMsg && (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
                {errorMsg}
              </p>
            )}

            {savedNote && (
              <p className="rounded-md border border-brand-border bg-brand-bg p-3 text-xs text-brand-teal">
                {savedNote}
              </p>
            )}

            {/* transcript */}
            <div
              ref={scrollRef}
              className="flex min-h-52 max-h-96 flex-col gap-2 overflow-y-auto rounded-md border border-brand-border bg-brand-bg p-3"
            >
              {turns.length === 0 && !busy && (
                <p className="m-auto text-sm text-brand-muted">
                  {callActive ? 'Waiting for agent greeting…' : 'Start a call to begin.'}
                </p>
              )}

              {turns.map((turn, i) => (
                <div
                  key={i}
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    turn.speaker === 'agent'
                      ? 'self-start bg-brand-surface text-brand-text'
                      : 'self-end bg-brand-violet text-white'
                  }`}
                >
                  <span className="mb-1 block text-xs opacity-60">
                    {turn.speaker === 'agent' ? agentName : 'You'}
                  </span>
                  {turn.text}
                </div>
              ))}

              {interim && (
                <div className="max-w-[80%] self-end rounded-lg bg-brand-violet/50 px-3 py-2 text-sm text-white">
                  <span className="mb-1 block text-xs opacity-60">You (speaking…)</span>
                  {interim}
                </div>
              )}

              {busy && (
                <div className="self-start rounded-lg bg-brand-surface px-3 py-2 text-sm text-brand-muted">
                  <span className="mb-1 block text-xs opacity-60">{agentName}</span>
                  Thinking…
                </div>
              )}
            </div>

            {/* typed fallback */}
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendText()}
                placeholder={callActive ? 'Or type what the caller says…' : 'Start a call first'}
                disabled={!callActive || busy}
                className="border-brand-border bg-brand-bg text-brand-text placeholder:text-brand-muted"
              />
              <Button onClick={handleSendText} disabled={!callActive || busy || !input.trim()}>
                <Send className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
