'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Volume2, Loader2, MapPin, Clock3, Stethoscope, ShieldCheck, AudioLines } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Waveform } from '@/components/voice/waveform'
import { DoctorCard } from '@/components/voice/doctor-card'
import { readJsonLines } from '@/lib/voice/protocol'
import { detectCallLanguage, languageLocales, localized, type CallLanguage } from '@/lib/voice/language'
import { voicePresets, selectBrowserVoice, type VoicePresetId } from '@/lib/voice/presets'
import type { PublicDoctor } from '@/types/database'

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
  const [clinic, setClinic] = useState<{ clinic_name: string; address: string; phone: string; opening_hours: string } | null>(null)
  const [doctors, setDoctors] = useState<PublicDoctor[]>([])
  const [highlighted, setHighlighted] = useState<string[]>([])
  const [directoryAvailable, setDirectoryAvailable] = useState(true)
  const [bookingDraft, setBookingDraft] = useState<{ name: string | null; phone: string | null; concern: string | null; doctor: string | null; time: string | null; consent: boolean | null; active: boolean } | null>(null)
  const [language, setLanguage] = useState<CallLanguage>('en')
  const [preset, setPreset] = useState<VoicePresetId>('warm-female')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceUri, setVoiceUri] = useState('')
  const [inputOverride, setInputOverride] = useState('')
  const currentLanguage = useRef<CallLanguage>('en')
  const presetRef = useRef<VoicePresetId>('warm-female')
  const voiceUriRef = useRef('')
  const inputOverrideRef = useRef('')
  const pendingSpoken = useRef('')
  const requestStarted = useRef(0)
  const [responseTime, setResponseTime] = useState<number | null>(null)
  const orbRef = useRef<HTMLDivElement>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const animationFrame = useRef(0)
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

  useEffect(() => {
    const synth = window.speechSynthesis
    const update = () => setVoices(synth?.getVoices() ?? [])
    update(); synth?.addEventListener('voiceschanged', update)
    try {
      const saved = localStorage.getItem('voxa-voice-style')
      if (voicePresets.some(item => item.id === saved)) { presetRef.current = saved as VoicePresetId; setPreset(saved as VoicePresetId) }
      const uri = localStorage.getItem('voxa-native-voice') ?? ''; voiceUriRef.current = uri; setVoiceUri(uri)
    } catch { /* Browser storage can be unavailable in private sessions. */ }
    return () => synth?.removeEventListener('voiceschanged', update)
  }, [])

  function startMeter(media: MediaStream) {
    try {
      const context = new AudioContext(); audioContext.current = context
      const analyser = context.createAnalyser(); analyser.fftSize = 256
      context.createMediaStreamSource(media).connect(analyser)
      const samples = new Uint8Array(analyser.frequencyBinCount)
      const draw = () => {
        analyser.getByteFrequencyData(samples)
        const amplitude = mute.current ? 0 : samples.reduce((sum, n) => sum + n, 0) / samples.length / 255
        orbRef.current?.style.setProperty('--mic-level', String(amplitude))
        animationFrame.current = requestAnimationFrame(draw)
      }
      void context.resume().catch(() => {}); draw()
    } catch { /* Visual microphone meter is optional; the call still works. */ }
  }

  function changeListeningLanguage(value: string) {
    inputOverrideRef.current = value; setInputOverride(value)
    if (value) { const lang = value.split('-')[0] as CallLanguage; currentLanguage.current = lang; setLanguage(lang) }
    try { localStorage.setItem('voxa-speech-input-language', value) } catch {}
    if (active.current && phaseRef.current === 'listening') { stopRecognition(); listenRef.current() }
  }

  function changeVoice(value: VoicePresetId) {
    presetRef.current = value; setPreset(value)
    try { localStorage.setItem('voxa-voice-style', value) } catch { /* optional */ }
  }

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
    cancelAnimationFrame(animationFrame.current)
    void audioContext.current?.close().catch(() => {})
    audioContext.current = null
  }

  useEffect(() => {
    let cancelled = false
    setSupported(Boolean(recognitionType()) && 'speechSynthesis' in window && Boolean(navigator.mediaDevices?.getUserMedia))
    fetch(base).then(async res => {
      if (!res.ok) throw new Error('This call is unavailable. Please check the link or agent.')
      return res.json()
    }).then(data => {
      if (cancelled) return
      setName(data.agent.name); setClinic(data.clinic); setDoctors(data.doctors ?? []); setDirectoryAvailable(data.directoryAvailable !== false)
      const preferred = navigator.languages?.find(value => /^(ur|pa|hi)\b/.test(value)) ?? navigator.language
      const initial = /^(ur|pa|hi)\b/.exec(preferred)?.[1] as CallLanguage | undefined
      let storedLocale = ''
      try { storedLocale = localStorage.getItem('voxa-speech-input-language') ?? '' } catch {}
      const configured = String(data.agent.language).split('-')[0]
      const lang: CallLanguage = storedLocale ? storedLocale.split('-')[0] as CallLanguage : ['en', 'ur', 'pa', 'hi'].includes(configured) ? configured as CallLanguage : initial ?? 'en'
      inputOverrideRef.current = storedLocale; setInputOverride(storedLocale)
      currentLanguage.current = lang; setLanguage(lang)
      const aliases: Record<string, VoicePresetId> = { nova: 'warm-female', echo: 'calm-male', alloy: 'gentle', shimmer: 'clear-female' }
      const defaultVoice = aliases[data.agent.voice] ?? data.agent.voice
      try { if (!localStorage.getItem('voxa-voice-style') && voicePresets.some(item => item.id === defaultVoice)) { presetRef.current = defaultVoice; setPreset(defaultVoice) } } catch {}
    })
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
    const session = generation.current
    pendingSpoken.current = ''
    requestStarted.current = performance.now()
    let playback = Promise.resolve()
    const enqueue = (text: string) => {
      playback = playback.then(async () => {
        if (!active.current || generation.current !== session) return
        pendingSpoken.current += (pendingSpoken.current ? ' ' : '') + text
        if (phaseRef.current !== 'speaking') setResponseTime((performance.now() - requestStarted.current) / 1000)
        changePhase('speaking'); await speak(text)
      })
    }
    const res = await fetch(token ? `${base}/converse` : '/api/voice/converse', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(agentId ? { agent_id: agentId } : {}), history: history.current, stream: true, language_hint: currentLanguage.current }),
      signal: request.current.signal,
    })
    if (!res.ok) { const data = await res.json(); throw new Error(data.error ?? 'The agent could not connect.') }
    if (!res.body) throw new Error('Voice response was empty')
    let reply = '', done = false
    if (res.headers.get('content-type')?.includes('application/x-ndjson')) {
      for await (const event of readJsonLines<{ type: string; text?: string; language?: CallLanguage; doctorIds?: string[]; reply?: string; error?: string; bookingDraft?: typeof bookingDraft }>(res.body)) {
        if (!active.current || generation.current !== session) break
        if (event.type === 'meta') {
          if (event.language) { currentLanguage.current = event.language; setLanguage(event.language) }
          setHighlighted(event.doctorIds ?? [])
          if (event.bookingDraft) setBookingDraft(event.bookingDraft)
        } else if (event.type === 'sentence' && event.text) enqueue(event.text)
        else if (event.type === 'done') { reply = event.reply ?? ''; done = true }
        else if (event.type === 'error') throw new Error(event.error ?? 'Voice response interrupted')
      }
    } else {
      const data = await res.json(); reply = data.reply; done = true; enqueue(reply)
    }
    if (!done && active.current && generation.current === session) throw new Error('Voice connection interrupted. Please repeat your last request.')
    return { reply, playback }
  }

  function speak(text: string) {
    return new Promise<void>(resolve => {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      const selection = selectBrowserVoice(window.speechSynthesis.getVoices(), currentLanguage.current, presetRef.current, voiceUriRef.current)
      utterance.lang = languageLocales[currentLanguage.current]
      utterance.rate = selection.preset.rate; utterance.pitch = selection.preset.pitch
      if (selection.voice) utterance.voice = selection.voice
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
    rec.lang = inputOverrideRef.current || languageLocales[currentLanguage.current]; rec.continuous = false; rec.interimResults = false
    let text = ''
    let failed = false
    rec.onresult = event => {
      text = Array.from(event.results).filter(result => result.isFinal).map(result => result[0].transcript).join(' ').trim()
      // A final speech result is ready to send; do not wait for the browser's
      // extra recognition-session silence timeout before contacting the agent.
      if (text && active.current && !mute.current && recognition.current === rec) {
        void turnRef.current(text)
      }
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
    currentLanguage.current = detectCallLanguage(text, currentLanguage.current); setLanguage(currentLanguage.current)
    history.current.push({ speaker: 'caller', text })
    changePhase('thinking')
    const session = generation.current
    try {
      const { reply, playback } = await converse()
      if (!active.current || session !== generation.current) return
      await playback
      if (active.current && session === generation.current) { history.current.push({ speaker: 'agent', text: reply }); pendingSpoken.current = ''; listenRef.current() }
    } catch (err) {
      if (!active.current || session !== generation.current) return
      generation.current++; request.current?.abort(); window.speechSynthesis.cancel(); finishSpeech.current?.()
      if (pendingSpoken.current) { history.current.push({ speaker: 'agent', text: pendingSpoken.current }); pendingSpoken.current = '' }
      setError(err instanceof Error ? err.message : 'Connection interrupted.')
      listenRef.current()
    }
  }

  async function startCall() {
    if (active.current || saving) return
    const session = ++generation.current
    active.current = true; mute.current = false; setMuted(false)
    history.current = []; setError(''); setNote(''); setElapsed(0); setBookingDraft(null); setHighlighted([])
    started.current = Date.now(); changePhase('connecting')
    // Prime speech synthesis during the user gesture for mobile browsers.
    window.speechSynthesis.resume()
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      if (!active.current || session !== generation.current) { media.getTracks().forEach(t => t.stop()); return }
      stream.current = media
      startMeter(media)
      const { reply, playback } = await converse()
      if (!active.current || session !== generation.current) return
      await playback
      if (active.current && session === generation.current) { history.current.push({ speaker: 'agent', text: reply }); pendingSpoken.current = ''; listenRef.current() }
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
    const transcript = [...history.current, ...(pendingSpoken.current ? [{ speaker: 'agent' as const, text: pendingSpoken.current }] : [])]
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
    if (pendingSpoken.current) history.current.push({ speaker: 'agent', text: pendingSpoken.current })
    pendingSpoken.current = ''; generation.current++; request.current?.abort(); window.speechSynthesis.cancel(); finishSpeech.current?.(); listenRef.current()
  }

  const inCall = phase !== 'idle' && phase !== 'ended'
  const label = phase === 'listening' && muted ? 'Microphone muted' : ({ idle: 'A conversation, just a call away.', connecting: 'Connecting your call', listening: 'Listening to you', thinking: 'One moment', speaking: `${name || 'Your agent'} is speaking`, ended: 'Call ended' })[phase]

  const selection = selectBrowserVoice(voices, language, preset, voiceUri)
  const orderedDoctors = [...doctors].sort((a, b) => Number(highlighted.includes(b.id)) - Number(highlighted.includes(a.id)))
  function askDoctor(doctor: PublicDoctor) {
    if (!active.current || phaseRef.current === 'thinking' || phaseRef.current === 'connecting') return
    if (phaseRef.current === 'speaking') interrupt()
    void turnRef.current(localized(currentLanguage.current, `Tell me about ${doctor.name}`, `\u0645\u062c\u06be\u06d2 ${doctor.name} \u06a9\u06d2 \u0628\u0627\u0631\u06d2 \u0645\u06cc\u06ba \u0628\u062a\u0627\u0626\u06cc\u06ba`, `${doctor.name} \u0628\u0627\u0631\u06d2 \u062f\u0633\u0648`, `${doctor.name} \u0915\u0947 \u092c\u093e\u0930\u0947 \u092e\u0947\u0902 \u092c\u0924\u093e\u090f\u0901`))
  }
  return (
    <section className="clinic-call-shell mx-auto w-full max-w-7xl text-brand-text">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-brand-border bg-brand-surface px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3"><div className="flex size-11 items-center justify-center rounded-xl bg-brand-teal/20"><Stethoscope className="size-5" /></div><div><p className="font-display text-lg font-semibold">{clinic?.clinic_name || name || 'Clinic reception'}</p><p className="mt-0.5 font-data text-[10px] uppercase tracking-[.18em] text-brand-muted">Your care starts with a conversation</p></div></div>
        <div className="flex items-center gap-2 rounded-full border border-brand-border bg-brand-surface-raised px-3 py-2 text-xs"><span className={`size-2 rounded-full ${inCall ? 'animate-pulse bg-brand-teal' : 'bg-brand-muted/50'}`} />{inCall ? 'Reception call connected' : 'Virtual reception'}</div>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-5 lg:sticky lg:top-6">
          <div className="clinic-voice-room relative flex min-h-[590px] flex-col items-center justify-between overflow-hidden rounded-[2rem] border border-brand-border bg-brand-surface p-6 text-center sm:p-8">
            <div className="relative z-10 flex w-full items-center justify-between"><span className="flex items-center gap-2 font-data text-[10px] uppercase tracking-[.18em]"><Waveform />VOXA / Care line</span><span className="flex items-center gap-1.5 text-xs text-brand-muted"><ShieldCheck className="size-3.5" />Clinic receptionist</span></div>
            <div className="relative z-10 flex flex-col items-center py-6"><p className="font-data text-[10px] uppercase tracking-[.24em] text-brand-muted">A familiar voice. A little more care.</p><h1 className="mt-3 font-display text-3xl tracking-tight sm:text-4xl">{name || 'Connecting...'}</h1>
              <div ref={orbRef} className={`voice-orbit clinic-orbit my-8 ${phase === 'speaking' ? 'voice-speaking' : phase === 'listening' && !muted ? 'voice-listening' : ''}`} aria-hidden="true"><span className="clinic-orbit-ring" /><div className="voice-orb"><AudioLines className={`size-20 stroke-[1] text-brand-text/70 ${phase === 'thinking' ? 'animate-pulse' : ''}`} /></div><span className="clinic-orbit-dot" /></div>
              <p role="status" aria-live="polite" className="text-base">{label}</p><p className="mt-2 font-data text-xs tabular-nums text-brand-muted">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</p>
              {phase === 'speaking' && <button onClick={interrupt} className="mt-3 rounded-full border border-brand-border px-4 py-2 text-xs text-brand-muted hover:bg-brand-bg">Tap to speak</button>}
            </div>
            <div className="relative z-10 flex w-full flex-col items-center gap-4">
              <label className="flex items-center gap-3 rounded-full border border-brand-border bg-brand-surface-raised px-4 py-2 text-xs"><Mic className="size-3.5" />Listening language<select aria-label="Microphone listening language" disabled={inCall && phase !== 'listening'} value={inputOverride || languageLocales[language]} onChange={event => changeListeningLanguage(event.target.value)} className="max-w-36 bg-transparent font-medium outline-none"><option value="ur-PK">Urdu</option><option value="en-US">English</option><option value="pa-PK">Punjabi</option><option value="hi-IN">Hindi</option></select></label>
              {!supported && <p role="alert" className="text-sm text-red-700">Open in Chrome or Edge and allow microphone access for audio calls.</p>}
              {error && <p role="alert" className="w-full rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
              {note && <p role="status" className="text-xs text-brand-muted">{note}</p>}
              {highlighted.length > 0 && doctors.some(doctor => highlighted.includes(doctor.id)) && <button onClick={() => document.getElementById(`doctor-${highlighted[0]}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })} className="rounded-full border border-brand-teal bg-brand-teal/15 px-4 py-2 text-xs">View doctor profile</button>}
              <div className="flex items-center justify-center gap-5">{inCall ? <><button onClick={toggleMute} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={muted} className={`flex size-14 items-center justify-center rounded-full border border-brand-border ${muted ? 'bg-brand-text text-brand-bg' : 'bg-brand-bg'}`}>{muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}</button><button onClick={endCall} aria-label="End call" className="flex size-16 items-center justify-center rounded-full bg-[#B74434] text-white shadow-lg hover:bg-[#9c382b]"><PhoneOff className="size-6" /></button><span aria-label="Speaker enabled" className="flex size-14 items-center justify-center rounded-full border border-brand-border bg-brand-bg"><Volume2 className="size-5" /></span></> : <Button onClick={startCall} disabled={!name || !supported || saving} className="h-14 rounded-full px-8 text-base">{saving ? <Loader2 className="size-5 animate-spin" /> : <Phone className="size-5" />}{saving ? 'Saving call' : phase === 'ended' ? 'Call reception again' : 'Talk to reception'}</Button>}</div>
              <p className="max-w-sm text-xs leading-relaxed text-brand-muted">{inCall ? 'Speak naturally. Doctor profiles appear beside your call. Hang up to save your request.' : 'Ask about our doctors, clinic information or an appointment. No chat box, just your voice.'}</p>
              <div className="flex flex-wrap justify-center gap-3 font-data text-[9px] uppercase tracking-widest text-brand-muted"><span>Reply: {({en:'English',ur:'Urdu',pa:'Punjabi',hi:'Hindi'})[language]}</span>{responseTime !== null && <span>Last response {responseTime.toFixed(1)}s</span>}</div>
            </div>
          </div>
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-display text-base font-medium">Choose the voice's tone</h2><p className="mt-1 text-xs text-brand-muted">Language follows the conversation. Tone is your choice.</p></div><button disabled={inCall || !supported} onClick={() => void speak(language === 'en' ? 'Hello. Welcome to our clinic.' : language === 'hi' ? '\u0928\u092e\u0938\u094d\u0924\u0947' : '\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u06cc\u06a9\u0645')} className="rounded-full border border-brand-border px-3 py-2 text-xs disabled:opacity-40">Preview</button></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{voicePresets.map(item => <button key={item.id} onClick={() => changeVoice(item.id)} aria-pressed={preset === item.id} className={`rounded-xl border p-3 text-left transition-colors ${preset === item.id ? 'border-brand-text bg-brand-text text-brand-bg' : 'border-brand-border hover:bg-brand-bg'}`}><p className="text-xs font-medium">{item.label}</p><p className={`mt-1 text-[10px] ${preset === item.id ? 'text-brand-bg/70' : 'text-brand-muted'}`}>{item.detail}</p></button>)}</div>
            <p className="mt-3 text-[11px] leading-relaxed text-brand-muted">{!selection.languageAvailable ? 'No matching voice is installed for this language. Audio pronunciation may be limited; install a matching system voice.' : !selection.styleAvailable ? `Using ${selection.voice?.name}. This device has no matching gender-labelled voice; the preset adjusts tone and speed.` : `Native voice: ${selection.voice?.name || 'System default'}. Youthful is a tone preset, not a recorded child voice.`}</p>
            <details className="mt-3 text-xs text-brand-muted"><summary className="cursor-pointer">Device voice and speech input settings</summary><div className="mt-3 grid gap-3"><label className="grid gap-1.5">Native voice<select value={voiceUri} onChange={event => { setVoiceUri(event.target.value); voiceUriRef.current = event.target.value; try { localStorage.setItem('voxa-native-voice', event.target.value) } catch {} }} className="w-full rounded-lg border border-brand-border bg-brand-bg p-2"><option value="">Automatic for this language</option>{voices.filter(voice => voice.lang.split('-')[0] === language).map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}</select></label><label className="grid gap-1.5">Speech input fallback<select value={inputOverride} onChange={event => changeListeningLanguage(event.target.value)} className="rounded-lg border border-brand-border bg-brand-bg p-2"><option value="">Automatic / current conversation</option><option value="en-US">English</option><option value="ur-PK">Urdu</option><option value="pa-PK">Punjabi (Pakistan)</option><option value="hi-IN">Hindi</option></select></label><p>Browser recognition uses one listening language at a time. If your first words are misheard, choose the input fallback. Replies adapt to the recognized language.</p></div></details>
          </div>
        </div>
        <aside className="space-y-5">
          {bookingDraft?.active && <div className="rounded-2xl border border-brand-teal bg-brand-teal/10 p-5"><p className="font-data text-[10px] uppercase tracking-widest text-brand-muted">Your visit request</p><h2 className="mt-2 font-display text-xl">Details for reception</h2><dl className="mt-4 space-y-3 text-sm">{[['Patient', bookingDraft.name], ['WhatsApp number', bookingDraft.phone], ['Your concern', bookingDraft.concern], ['Requested doctor', bookingDraft.doctor], ['Preferred time', bookingDraft.time]].map(([label, value]) => <div key={label}><dt className="text-xs text-brand-muted">{label}</dt><dd dir="auto" className="mt-1">{value || 'Still to be collected'}</dd></div>)}</dl><p className="mt-4 text-xs leading-relaxed text-brand-muted">Request only. The clinic checks details and confirms the slot. WhatsApp permission: {bookingDraft.consent === null ? 'not asked yet' : bookingDraft.consent ? 'agreed' : 'declined'}.</p></div>}

          <div className="rounded-2xl border border-brand-border bg-brand-surface p-5"><p className="font-data text-[10px] uppercase tracking-[.2em] text-brand-muted">Your clinic at a glance</p><h2 className="mt-2 font-display text-2xl">{clinic?.clinic_name || 'Clinic information'}</h2><div className="mt-4 space-y-3 text-sm text-brand-muted">{clinic?.address && <p className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0" />{clinic.address}</p>}{clinic?.opening_hours && <p className="flex gap-2"><Clock3 className="mt-0.5 size-4 shrink-0" />{clinic.opening_hours}</p>}{clinic?.phone && <p className="flex gap-2"><Phone className="size-4 shrink-0" /><a href={`tel:${clinic.phone}`}>{clinic.phone}</a></p>}{!clinic && <p>The clinic has not published its details yet.</p>}</div></div>
          <div><div className="mb-3 flex items-end justify-between gap-3"><div><p className="font-data text-[10px] uppercase tracking-[.2em] text-brand-muted">People behind your care</p><h2 className="mt-1 font-display text-2xl">Meet our doctors</h2></div><span className="rounded-full bg-brand-teal/20 px-3 py-1 text-xs">{directoryAvailable ? doctors.length : '-'} profiles</span></div><p className="mb-4 text-xs leading-relaxed text-brand-muted">Profiles are supplied by the clinic. Reception confirms suitability and available appointments.</p><div className="space-y-4">{orderedDoctors.map(doctor => <DoctorCard key={doctor.id} doctor={doctor} highlighted={highlighted.includes(doctor.id)} onAsk={inCall && phase !== 'thinking' && phase !== 'connecting' ? askDoctor : undefined} />)}{!doctors.length && <div className="rounded-2xl border border-dashed border-brand-border p-8 text-center text-sm text-brand-muted">{directoryAvailable ? 'The clinic has not added doctor profiles yet.' : 'Doctor information is currently unavailable. Please contact reception.'}</div>}</div></div>
        </aside>
      </div>
    </section>
  )
}
