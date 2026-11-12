'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Mic, Phone, PhoneOff, Send, Volume2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Waveform } from '@/components/voice/waveform'

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

type Turn = { speaker: 'caller' | 'agent'; text: string }
type CallStatus = 'idle' | 'thinking' | 'speaking' | 'listening'

const STATUS_LABEL: Record<CallStatus, string> = {
  idle: 'Ready to call',
  thinking: 'Thinking…',
  speaking: 'Speaking — tap Interrupt to talk',
  listening: 'Listening… speak now',
}

export default function PublicCallPage() {
  const { token } = useParams<{ token: string }>()

  const [agentName, setAgentName] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [callActive, setCallActive] = useState(false)
  const [status, setStatus] = useState<CallStatus>('idle')
  const [turns, setTurns] = useState<Turn[]>([])
  const [interim, setInterim] = useState('')
  const [input, setInput] = useState('')
  const [micSupported, setMicSupported] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

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
    fetch(`/api/public/call/${token}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled) return
        if (data?.agent?.name) setAgentName(data.agent.name)
        else setNotFound(true)
      })
      .catch(() => !cancelled && setNotFound(true))
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, interim, status])

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

  function pickVoice(): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis.getVoices()
    if (voices.length === 0) return null
    const en = voices.filter(v => v.lang.toLowerCase().startsWith('en'))
    return (
      en.find(v => /natural|neural|online/i.test(v.name)) ??
      en.find(v => /google/i.test(v.name)) ??
      en[0] ??
      voices[0]
    )
  }

  const speak = useCallback((text: string): Promise<void> => {
    return new Promise(resolve => {
      if (typeof window === 'undefined' || !window.speechSynthesis) return resolve()
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      const voice = pickVoice()
      if (voice) utterance.voice = voice
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(guard)
        resolve()
      }
      const guard = setTimeout(finish, Math.max(4000, text.length * 120))
      utterance.onend = finish
      utterance.onerror = finish
      window.speechSynthesis.speak(utterance)
    })
  }, [])

  const startListening = useCallback(() => {
    if (!activeRef.current) return
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
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
      if (finalText.trim()) recognition.stop()
    }
    recognition.onend = () => {
      setInterim('')
      if (!activeRef.current) return
      const text = finalText.trim()
      if (text) {
        void handleCallerUtterance(text)
      } else if (statusRef.current === 'listening') {
        try {
          recognition.start()
        } catch {
          startListening()
        }
      }
    }
    recognition.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setErrorMsg('Microphone is blocked — you can still type below.')
      }
    }
    setStatusBoth('listening')
    try {
      recognition.start()
    } catch {
      /* already started */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const converse = useCallback(
    async (history: Turn[]): Promise<string | null> => {
      try {
        const res = await fetch(`/api/public/call/${token}/converse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ history }),
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
    [token]
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

  async function startCall() {
    setErrorMsg(null)
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
        await fetch(`/api/public/call/${token}/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, duration_seconds: duration }),
        })
      } catch {
        /* best effort */
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

  const busy = status === 'thinking'

  return (
    <div className="flex min-h-screen flex-col bg-brand-bg">
      <header className="flex h-14 items-center justify-center border-b border-brand-border">
        <div className="flex items-center gap-2.5">
          <Waveform />
          <span className="font-display text-base font-bold uppercase tracking-[0.26em] text-brand-text">
            VOXA
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-8">
        {notFound ? (
          <p className="text-center text-sm text-brand-muted">
            This call link is not valid or the line is closed.
          </p>
        ) : (
          <Card className="border-brand-border bg-brand-surface">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div className="flex flex-col gap-1">
                <span className="font-display text-lg font-bold text-brand-text">
                  {agentName ?? 'Connecting…'}
                </span>
                <span className="flex items-center gap-2 text-xs text-brand-muted">
                  <span
                    className={`size-2 rounded-full ${callActive ? 'bg-[#7E9B76] animate-pulse' : 'bg-brand-muted'}`}
                  />
                  {STATUS_LABEL[status]}
                  {status === 'speaking' && <Waveform active />}
                  {status === 'listening' && micSupported && (
                    <Mic className="size-3.5 animate-pulse text-[#7E9B76]" />
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {callActive && status === 'speaking' && (
                  <Button variant="outline" size="sm" onClick={interruptAgent}>
                    <Volume2 className="size-4" />
                    Interrupt
                  </Button>
                )}
                {!callActive ? (
                  <Button onClick={startCall} disabled={!agentName}>
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
                  This browser doesn&apos;t support voice input — typing works below.
                  For the full voice experience, open this link in Chrome or Edge.
                </p>
              )}
              {errorMsg && (
                <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600">
                  {errorMsg}
                </p>
              )}

              <div
                ref={scrollRef}
                className="flex min-h-52 max-h-96 flex-col gap-2 overflow-y-auto rounded-md border border-brand-border bg-brand-bg p-3"
              >
                {turns.length === 0 && !busy && (
                  <p className="m-auto text-sm text-brand-muted">
                    {callActive ? 'Connecting…' : 'Press Start call and say hello.'}
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
                      {turn.speaker === 'agent' ? agentName ?? 'Agent' : 'You'}
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
                    <span className="mb-1 block text-xs opacity-60">{agentName ?? 'Agent'}</span>
                    Thinking…
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendText()}
                  placeholder={callActive ? 'Or type your message…' : 'Start the call first'}
                  disabled={!callActive || busy}
                  className="border-brand-border bg-brand-bg text-brand-text placeholder:text-brand-muted"
                />
                <Button onClick={handleSendText} disabled={!callActive || busy || !input.trim()}>
                  <Send className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      <footer className="flex h-12 items-center justify-center border-t border-brand-border font-data text-[10px] uppercase tracking-[0.18em] text-brand-muted">
        Powered by VOXA // AI voice agents
      </footer>
    </div>
  )
}
