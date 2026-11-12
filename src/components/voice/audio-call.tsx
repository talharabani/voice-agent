'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Volume2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Waveform } from '@/components/voice/waveform'

type Turn = { speaker: 'caller' | 'agent'; text: string }
type Phase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended'
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  start(): void; abort(): void; stop(): void
}
type RecognitionConstructor = new () => Recognition
function recognitionType() {
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export function AudioCall({ agentId, token }: { agentId?: string; token?: string }) {
  const [name, setName] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [supported, setSupported] = useState(true)
  const active = useRef(false)
  const mute = useRef(false)
  const generation = useRef(0)
  const history = useRef<Turn[]>([])
  const recognition = useRef<Recognition | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const request = useRef<AbortController | null>(null)
  const started = useRef(0)
  const phaseRef = useRef<Phase>('idle')
  const finishSpeech = useRef<(() => void) | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listenRef = useRef<() => void>(() => {})
  const turnRef = useRef<(text: string) => Promise<void>>(async () => {})
  const base = token ? `/api/public/call/${token}` : `/api/agents/${agentId}`

  function changePhase(value: Phase) { phaseRef.current = value; setPhase(value) }
  function stopRecognition() {
    if (retryTimer.current) clearTimeout(retryTimer.current)
    const old = recognition.current
    recognition.current = null
    if (old) { old.onend = null; old.onresult = null; old.onerror = null; old.abort() }
  }
  function stopAudio() {
    stopRecognition()
    window.speechSynthesis?.cancel()
    finishSpeech.current?.()
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
  }

  useEffect(() => {
    let cancelled = false
    setSupported(Boolean(recognitionType()) && 'speechSynthesis' in window && Boolean(navigator.mediaDevices?.getUserMedia))
    fetch(base).then(async res => {
      if (!res.ok) throw new Error('This call is unavailable. Please check the link or agent.')
      return res.json()
    }).then(data => { if (!cancelled) setName(data.agent.name) })
      .catch(err => { if (!cancelled) setError(err.message) })
    return () => {
      cancelled = true; active.current = false; generation.current++
      request.current?.abort(); stopAudio()
    }
    // The resource changes only when navigating to another agent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])

  useEffect(() => {
    if (phase === 'idle' || phase === 'ended') return
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [phase])

  async function converse() {
    request.current = new AbortController()
    const res = await fetch(token ? `${base}/converse` : '/api/voice/converse', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(agentId ? { agent_id: agentId } : {}), history: history.current }),
      signal: request.current.signal,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'The agent could not connect. Please try again.')
    return data.reply as string
  }

  function speak(text: string) {
    return new Promise<void>(resolve => {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      const voices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'))
      const voice = voices.find(v => /natural|neural|google/i.test(v.name)) ?? voices[0]
      if (voice) utterance.voice = voice
      let finished = false
      const done = () => {
        if (finished) return
        finished = true; clearTimeout(timer); finishSpeech.current = null; resolve()
      }
      const timer = setTimeout(() => { window.speechSynthesis.cancel(); done() }, Math.max(10000, text.length * 150))
      finishSpeech.current = done
      utterance.onend = done
      utterance.onerror = done
      window.speechSynthesis.speak(utterance)
    })
  }

  listenRef.current = () => {
    if (!active.current) return
    changePhase('listening')
    if (mute.current) return
    stopRecognition()
    const Ctor = recognitionType()
    if (!Ctor) return
    const rec = new Ctor()
    recognition.current = rec
    rec.lang = 'en-US'; rec.continuous = false; rec.interimResults = false
    let text = ''
    let failed = false
    rec.onresult = event => {
      text = Array.from(event.results).filter(result => result.isFinal).map(result => result[0].transcript).join(' ').trim()
    }
    rec.onerror = event => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      failed = true
      setError(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Allow microphone and speech recognition access in your browser, then start a new call.'
        : 'Voice recognition stopped. Check your connection and try unmuting the microphone.')
      mute.current = true; setMuted(true)
    }
    rec.onend = () => {
      if (!active.current || mute.current || failed || recognition.current !== rec) return
      if (text) { void turnRef.current(text); return }
      retryTimer.current = setTimeout(() => listenRef.current(), 400)
    }
    try { rec.start() } catch { setError('Could not start your microphone. End the call and try again.') }
  }

  turnRef.current = async text => {
    if (!active.current || phaseRef.current !== 'listening') return
    stopRecognition()
    if (history.current.length >= 78) {
      setError('This call has reached its conversation limit. End the call to save it.'); return
    }
    history.current.push({ speaker: 'caller', text })
    changePhase('thinking')
    const session = generation.current
    try {
      const reply = await converse()
      if (!active.current || session !== generation.current) return
      history.current.push({ speaker: 'agent', text: reply })
      changePhase('speaking'); await speak(reply)
      if (active.current && session === generation.current) listenRef.current()
    } catch (err) {
      if (!active.current || session !== generation.current) return
      setError(err instanceof Error ? err.message : 'Connection interrupted.')
      listenRef.current()
    }
  }

  async function startCall() {
    if (active.current || saving) return
    const session = ++generation.current
    active.current = true; mute.current = false; setMuted(false)
    history.current = []; setError(''); setNote(''); setElapsed(0)
    started.current = Date.now(); changePhase('connecting')
    // Prime speech synthesis during the user gesture for mobile browsers.
    window.speechSynthesis.resume()
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      if (!active.current || session !== generation.current) { media.getTracks().forEach(t => t.stop()); return }
      stream.current = media
      const reply = await converse()
      if (!active.current || session !== generation.current) return
      history.current.push({ speaker: 'agent', text: reply })
      changePhase('speaking'); await speak(reply)
      if (active.current && session === generation.current) listenRef.current()
    } catch (err) {
      if (session !== generation.current) return
      active.current = false; stopAudio(); changePhase('ended')
      setError(err instanceof Error ? err.message : 'Please allow microphone access and try again.')
    }
  }

  async function endCall() {
    if (!active.current) return
    active.current = false; generation.current++; request.current?.abort()
    stopAudio(); changePhase('ended')
    const transcript = [...history.current]
    if (!transcript.some(turn => turn.speaker === 'caller')) return
    setSaving(true); setNote('Saving your call and appointment request…')
    try {
      const res = await fetch(token ? `${base}/end` : '/api/voice/test-call', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(agentId ? { agent_id: agentId } : {}), transcript, duration_seconds: Math.round((Date.now() - started.current) / 1000) }),
      })
      if (!res.ok) throw new Error('Your call could not be saved. Please contact the clinic to confirm your request.')
      const data = await res.json()
      if (data.warnings?.length) { setNote(''); setError(data.warnings.join(' ')); return }
      setNote(token ? 'Your call has been saved. The clinic will review any appointment request.' : 'Call saved. Review conversations, leads and appointment requests in your dashboard.')
    } catch (err) { setNote(''); setError(err instanceof Error ? err.message : 'Could not save this call.') }
    finally { setSaving(false) }
  }

  function toggleMute() {
    mute.current = !mute.current; setMuted(mute.current)
    stream.current?.getAudioTracks().forEach(track => { track.enabled = !mute.current })
    if (mute.current) stopRecognition()
    else if (phaseRef.current === 'listening') listenRef.current()
  }
  function interrupt() {
    if (phaseRef.current !== 'speaking') return
    generation.current++; window.speechSynthesis.cancel(); finishSpeech.current?.(); listenRef.current()
  }

  const inCall = phase !== 'idle' && phase !== 'ended'
  const label = phase === 'listening' && muted ? 'Microphone muted' : ({ idle: 'A conversation, just a call away.', connecting: 'Connecting your call', listening: 'Listening to you', thinking: 'One moment', speaking: `${name || 'Your agent'} is speaking`, ended: 'Call ended' })[phase]

  return (
    <section className="relative mx-auto flex min-h-[76dvh] w-full max-w-5xl flex-col items-center justify-between overflow-hidden rounded-[2rem] border border-brand-border bg-brand-surface px-5 py-8 text-center sm:px-10 sm:py-10">
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex items-center gap-2"><Waveform /><span className="font-display font-bold tracking-widest">VOXA</span></div>
        <span className="rounded-full border border-brand-border px-3 py-1 font-data text-[10px] uppercase tracking-widest">{inCall ? 'Live voice' : 'Voice line'}</span>
      </div>
      <div className="my-10 flex flex-col items-center">
        <p className="mb-3 font-data text-[10px] uppercase tracking-[.25em] text-brand-muted">Your personal receptionist</p>
        <h1 className="font-display text-3xl font-medium tracking-tight sm:text-5xl">{name || 'Connecting…'}</h1>
        <div className={`voice-orbit my-10 ${phase === 'speaking' ? 'voice-speaking' : phase === 'listening' && !muted ? 'voice-listening' : ''}`} aria-hidden="true">
          <div className="voice-orb"><div className="flex h-16 items-center gap-1.5">{[22, 40, 58, 34, 48, 28, 16].map((height, i) => <span key={i} className="voice-bar w-1.5 rounded-full bg-brand-text/80" style={{ height, animationDelay: `${i * .13}s` }} />)}</div></div>
        </div>
        <p role="status" aria-live="polite" className="text-base text-brand-text">{label}</p>
        <p className="mt-3 font-data text-xs tabular-nums text-brand-muted">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</p>
        {phase === 'speaking' && <button onClick={interrupt} className="mt-4 text-sm text-brand-muted underline underline-offset-4">Tap to speak</button>}
      </div>
      <div className="flex w-full max-w-lg flex-col items-center gap-5">
        {!supported && <p role="alert" className="text-sm text-red-700">Open this page in Chrome or Edge with microphone access to make an audio call.</p>}
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {note && <p role="status" className="text-sm text-brand-muted">{note}</p>}
        <div className="flex items-center justify-center gap-6">
          {inCall ? <>
            <button onClick={toggleMute} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={muted} className={`flex size-14 items-center justify-center rounded-full border border-brand-border ${muted ? 'bg-brand-text text-brand-bg' : 'bg-brand-bg text-brand-text'}`}>
              {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </button>
            <button onClick={endCall} aria-label="End call" className="flex size-16 items-center justify-center rounded-full bg-[#B74434] text-white shadow-lg hover:bg-[#9c382b]"><PhoneOff className="size-6" /></button>
            <span aria-label="Speaker audio enabled" className="flex size-14 items-center justify-center rounded-full border border-brand-border bg-brand-bg"><Volume2 className="size-5" /></span>
          </> : <Button onClick={startCall} disabled={!name || !supported || saving} className="h-14 rounded-full px-8 text-base">{saving ? <Loader2 className="size-5 animate-spin" /> : <Phone className="size-5" />}{saving ? 'Saving call' : phase === 'ended' ? 'Call again' : 'Start voice call'}</Button>}
        </div>
        <p className="max-w-sm text-xs leading-relaxed text-brand-muted">{inCall ? 'Speak naturally. End the call to save your request.' : 'Audio only. Allow your microphone when prompted. Call details are saved for the clinic.'}</p>
      </div>
    </section>
  )
}
