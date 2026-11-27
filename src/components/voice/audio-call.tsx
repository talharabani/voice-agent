'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX, Loader2, MapPin, Clock3 } from 'lucide-react'
import { CloudOrb, type CloudOrbPhase } from '@/components/voice/cloud-orb'
import { createCallRingtone, type CallRingtone } from '@/lib/voice/ringtone'
import { useAudioOutputControl } from '@/lib/voice/use-audio-output'
import { getClientVoiceMode, type VoiceMode } from '@/lib/voice/mode'
import { primeSpeaker, playOnlineSpeech, prepareSpeechAudio } from '@/lib/voice/online-playback'
import { playBrowserSpeech } from '@/lib/voice/browser-playback'
import { DoctorCard } from '@/components/voice/doctor-card'
import { readJsonLines } from '@/lib/voice/protocol'
import { detectCallLanguage, languageLocales, localized, greetingFor, type CallLanguage } from '@/lib/voice/language'
import { voicePresets, selectBrowserVoice, type VoicePresetId } from '@/lib/voice/presets'
import type { PublicDoctor } from '@/types/database'

type Turn = { speaker: 'caller' | 'agent'; text: string }
type Phase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'buffering' | 'speaking' | 'ended'
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

const LiveKitCall = dynamic(
  () => import('@/components/voice/livekit-call').then((mod) => mod.LiveKitCall),
  {
    ssr: false,
    loading: () => (
      <section className="relative mx-auto flex min-h-[calc(100svh-5.5rem)] w-full max-w-md flex-col items-center justify-between px-5 pb-10 pt-8 text-center text-brand-text sm:py-12">
        <span
          data-voice-mode="livekit"
          className="absolute right-4 top-2 rounded-full border border-brand-border/70 bg-brand-surface/80 px-2.5 py-0.5 font-data text-[10px] text-brand-muted"
        >
          Mode: livekit
        </span>
        <header className="pt-4">
          <h1 className="font-display text-2xl font-medium tracking-tight sm:text-[1.85rem]">
            Clinic Reception
          </h1>
        </header>
        <div className="my-auto flex flex-col items-center py-6">
          <div className="cloud-orb-fallback size-[224px] rounded-full shadow-[0_18px_48px_rgba(78,104,90,0.16)] sm:size-[252px]" />
          <p className="mt-10 flex items-center gap-2 text-base text-brand-muted">
            <span className="size-2 animate-pulse rounded-full bg-brand-teal/70" />
            Ready
          </p>
        </div>
        <div className="h-16" />
      </section>
    ),
  }
)

export function AudioCall({ agentId, token, mode }: { agentId?: string; token?: string; mode?: VoiceMode }) {
  const voiceMode = mode ?? getClientVoiceMode()
  if (voiceMode === 'livekit') {
    return <LiveKitCall agentId={agentId} token={token} />
  }
  return <LegacyAudioCall agentId={agentId} token={token} />
}

function LegacyAudioCall({ agentId, token }: { agentId?: string; token?: string }) {
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
  const lastReplyText = useRef('')
  const [audioProblem, setAudioProblem] = useState(false)
  const speaker = useRef<HTMLAudioElement | null>(null)
  const [audioProvider, setAudioProvider] = useState('online')
  const [previewing, setPreviewing] = useState(false)
  const [previewAudible, setPreviewAudible] = useState(false)
  const requestStarted = useRef(0)
  const [responseTime, setResponseTime] = useState<number | null>(null)
  const orbRef = useRef<HTMLDivElement>(null)
  const audioLevelRef = useRef(0)
  const agentAudioLevelRef = useRef(0)
  const speakerAudioCtx = useRef<AudioContext | null>(null)
  const speakerAnalyser = useRef<AnalyserNode | null>(null)
  const speakerSourceAttached = useRef<WeakSet<HTMLAudioElement>>(new WeakSet())
  const speakerMeterFrame = useRef(0)
  const ringtoneRef = useRef<CallRingtone | null>(null)
  const [customerSpeaking, setCustomerSpeaking] = useState(false)
  const customerSpeakingRef = useRef(false)
  const lastCustomerVoiceAt = useRef(0)
  const [outputNotice, setOutputNotice] = useState('')
  const outputNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioOutput = useAudioOutputControl()
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
  const [messages, setMessages] = useState<Turn[]>([])
  const [streamingReply, setStreamingReply] = useState('')
  const [copiedChat, setCopiedChat] = useState(false)
  const recognition = useRef<Recognition | null>(null)
  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const whisperEnabled = useRef(true)
  const vadState = useRef({ speaking: false, lastVoiceAt: 0, startedAt: 0 })
  const stream = useRef<MediaStream | null>(null)
  const request = useRef<AbortController | null>(null)
  const started = useRef(0)
  const phaseRef = useRef<Phase>('idle')
  const finishSpeech = useRef<(() => void) | null>(null)
  const interruptRef = useRef<() => void>(() => {})
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
    function copyTranscript() {
    const all = [...messages, ...(streamingReply ? [{ speaker: 'agent' as const, text: streamingReply }] : [])]
    const formatted = all.map(m => `${m.speaker === 'caller' ? 'Caller' : 'Agent'}: ${m.text}`).join('\n')
    if (!formatted) return
    void navigator.clipboard?.writeText(formatted).then(() => {
      setCopiedChat(true)
      setTimeout(() => setCopiedChat(false), 1800)
    })
  }

  return () => synth?.removeEventListener('voiceschanged', update)
  }, [])

  function startMeter(media: MediaStream) {
    try {
      const context = new AudioContext(); audioContext.current = context
      const analyser = context.createAnalyser(); analyser.fftSize = 256
      context.createMediaStreamSource(media).connect(analyser)
      const samples = new Uint8Array(analyser.frequencyBinCount)
      let bargeFrames = 0
      const draw = () => {
        analyser.getByteFrequencyData(samples)
        const amplitude = mute.current ? 0 : samples.reduce((sum, n) => sum + n, 0) / samples.length / 255
        audioLevelRef.current = amplitude
        orbRef.current?.style.setProperty('--mic-level', String(amplitude))
        const nowTs = performance.now()
        if (phaseRef.current === 'listening' && !mute.current) {
          if (amplitude > 0.055) {
            lastCustomerVoiceAt.current = nowTs
            if (!customerSpeakingRef.current) {
              customerSpeakingRef.current = true
              setCustomerSpeaking(true)
            }
          } else if (customerSpeakingRef.current && nowTs - lastCustomerVoiceAt.current > 300) {
            customerSpeakingRef.current = false
            setCustomerSpeaking(false)
          }
        } else if (customerSpeakingRef.current) {
          customerSpeakingRef.current = false
          setCustomerSpeaking(false)
        }
        if (phaseRef.current === 'speaking' && !mute.current) {
          if (amplitude > 0.22) {
            bargeFrames++
            if (bargeFrames >= 7) {
              bargeFrames = 0
              interruptRef.current()
            }
          } else {
            bargeFrames = 0
          }
        } else {
          bargeFrames = 0
        }
        if (phaseRef.current === 'listening' && !mute.current && mediaRecorder.current?.state === 'recording') {
          const now = nowTs
          if (amplitude > 0.05) {
            vadState.current.speaking = true
            vadState.current.lastVoiceAt = now
          } else if (vadState.current.speaking && now - vadState.current.lastVoiceAt > 650) {
            vadState.current.speaking = false
            mediaRecorder.current.stop()
          } else if (now - vadState.current.startedAt > 15000 && vadState.current.speaking) {
            vadState.current.speaking = false
            mediaRecorder.current.stop()
          }
        }
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
  function pushTurn(turn: Turn) {
    history.current.push(turn)
    setMessages([...history.current])
  }
  function stopRecognition() {
    if (retryTimer.current) clearTimeout(retryTimer.current)
    const old = recognition.current
    recognition.current = null
    if (old) { old.onend = null; old.onresult = null; old.onerror = null; old.abort() }
    const rec = mediaRecorder.current
    mediaRecorder.current = null
    if (rec && rec.state !== 'inactive') {
      rec.ondataavailable = null
      rec.onstop = null
      try { rec.stop() } catch {}
    }
  }
  function attachSpeakerAnalyser(audioEl: HTMLAudioElement) {
    try {
      if (!speakerSourceAttached.current.has(audioEl)) {
        const ctx = speakerAudioCtx.current && speakerAudioCtx.current.state !== 'closed'
          ? speakerAudioCtx.current
          : new AudioContext()
        speakerAudioCtx.current = ctx
        const source = ctx.createMediaElementSource(audioEl)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyser.connect(ctx.destination)
        speakerAnalyser.current = analyser
        speakerSourceAttached.current.add(audioEl)
      }
      if (speakerAudioCtx.current?.state === 'suspended') {
        void speakerAudioCtx.current.resume().catch(() => {})
      }
      if (!speakerMeterFrame.current && speakerAnalyser.current) {
        const analyser = speakerAnalyser.current
        const bins = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          if (!speaker.current || speaker.current.paused || speaker.current.muted) {
            agentAudioLevelRef.current = 0
          } else {
            analyser.getByteFrequencyData(bins)
            let sum = 0
            for (let i = 0; i < bins.length; i++) sum += bins[i]
            agentAudioLevelRef.current = sum / bins.length / 255
          }
          speakerMeterFrame.current = requestAnimationFrame(tick)
        }
        speakerMeterFrame.current = requestAnimationFrame(tick)
      }
    } catch {
      /* Fallback to smooth orb cadence if Web Audio element routing is restricted */
    }
  }

  function stopAudio() {
    ringtoneRef.current?.stop({ playChime: false })
    stopRecognition()
    audioLevelRef.current = 0
    agentAudioLevelRef.current = 0
    cancelAnimationFrame(speakerMeterFrame.current)
    speakerMeterFrame.current = 0
    if (customerSpeakingRef.current) {
      customerSpeakingRef.current = false
      setCustomerSpeaking(false)
    }
    window.speechSynthesis?.cancel()
    finishSpeech.current?.()
    speaker.current?.pause()
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
    function copyTranscript() {
    const all = [...messages, ...(streamingReply ? [{ speaker: 'agent' as const, text: streamingReply }] : [])]
    const formatted = all.map(m => `${m.speaker === 'caller' ? 'Caller' : 'Agent'}: ${m.text}`).join('\n')
    if (!formatted) return
    void navigator.clipboard?.writeText(formatted).then(() => {
      setCopiedChat(true)
      setTimeout(() => setCopiedChat(false), 1800)
    })
  }

  return () => {
      cancelled = true; active.current = false; generation.current++
      request.current?.abort(); stopAudio()
      ringtoneRef.current?.dispose(); ringtoneRef.current = null
      if (outputNoticeTimer.current) clearTimeout(outputNoticeTimer.current)
      void speakerAudioCtx.current?.close().catch(() => {})
      speakerAudioCtx.current = null
    }
    // The resource changes only when navigating to another agent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])

  useEffect(() => {
    if (phase === 'idle' || phase === 'ended') return
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000)
    function copyTranscript() {
    const all = [...messages, ...(streamingReply ? [{ speaker: 'agent' as const, text: streamingReply }] : [])]
    const formatted = all.map(m => `${m.speaker === 'caller' ? 'Caller' : 'Agent'}: ${m.text}`).join('\n')
    if (!formatted) return
    void navigator.clipboard?.writeText(formatted).then(() => {
      setCopiedChat(true)
      setTimeout(() => setCopiedChat(false), 1800)
    })
  }

  return () => clearInterval(timer)
  }, [phase])

  async function converse() {
    request.current = new AbortController()
    const session = generation.current
    pendingSpoken.current = ''
    requestStarted.current = performance.now()
    let playback = Promise.resolve()
    const enqueue = (text: string) => {
      const prepared = prepareSpeechAudio({ text, language: currentLanguage.current, style: presetRef.current, token, agentId, signal: request.current!.signal })
      void prepared.catch(() => {})
      playback = playback.then(async () => {
        if (!active.current || generation.current !== session) return
        lastReplyText.current = text
        changePhase('buffering'); await speak(text, true, prepared)
      })
      void playback.catch(() => {})
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

  async function speak(text: string, track = false, prepared?: Promise<Blob>) {
    const control = new AbortController()
    const abortSpeech = () => control.abort()
    finishSpeech.current = abortSpeech
    const onStart = () => {
      setAudioProblem(false)
      if (!track) setPreviewAudible(true)
      if (track) {
        ringtoneRef.current?.stop({ playChime: true })
        pendingSpoken.current += (pendingSpoken.current ? ' ' : '') + text
        setStreamingReply(pendingSpoken.current)
        changePhase('speaking')
        setResponseTime((performance.now() - requestStarted.current) / 1000)
      }
    }
    try {
      speaker.current ??= new Audio()
      speaker.current.muted = audioOutput.agentAudioMuted
      attachSpeakerAnalyser(speaker.current)
      try {
        await playOnlineSpeech({ audio: speaker.current, text, language: currentLanguage.current, style: presetRef.current, token, agentId, signal: control.signal, onStart, prepared })
        setAudioProvider('online')
      } catch (onlineError) {
        if (control.signal.aborted) throw onlineError
        const native = selectBrowserVoice(window.speechSynthesis?.getVoices() ?? [], currentLanguage.current, presetRef.current, voiceUriRef.current)
        if (!native.voice) throw onlineError
        if (!audioOutput.agentAudioMuted) {
          await playBrowserSpeech({ text, language: currentLanguage.current, preset: presetRef.current, voiceUri: voiceUriRef.current, signal: control.signal, onStart })
        } else {
          onStart()
        }
        setAudioProvider('browser')
      }
    } catch (error) {
      if (!control.signal.aborted) setAudioProblem(true)
      throw error
    } finally { if (finishSpeech.current === abortSpeech) finishSpeech.current = null; if (!track) setPreviewAudible(false) }
  }

  async function replayAudio() {
    if (!lastReplyText.current) return
    stopRecognition(); setError(''); requestStarted.current = performance.now(); window.speechSynthesis?.resume()
    speaker.current ??= new Audio(); await primeSpeaker(speaker.current)
    try { await speak(lastReplyText.current, active.current) }
    catch (error) { setError(error instanceof Error ? error.message : 'Audio playback failed.') }
    finally { if (active.current) listenRef.current() }
  }

  async function previewVoice() {
    if (previewing || active.current) return
    setPreviewing(true)
    speaker.current ??= new Audio(); await primeSpeaker(speaker.current)
    const sample = greetingFor(clinic?.clinic_name || name || 'our clinic', currentLanguage.current)
    lastReplyText.current = sample
    try { await speak(sample); setError('') } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setError(error instanceof Error ? error.message : 'Voice preview failed.') } finally { setPreviewing(false) }
  }

  listenRef.current = () => {
    if (!active.current) return
    ringtoneRef.current?.stop({ playChime: false })
    changePhase('listening')
    if (mute.current) return
    stopRecognition()

    if (whisperEnabled.current && stream.current && typeof MediaRecorder !== 'undefined') {
      try {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
        const recorder = new MediaRecorder(stream.current, { mimeType })
        const chunks: Blob[] = []
        mediaRecorder.current = recorder
        vadState.current = { speaking: false, lastVoiceAt: 0, startedAt: performance.now() }
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
        recorder.onstop = async () => {
          if (!active.current || mute.current || phaseRef.current !== 'listening') return
          const blob = new Blob(chunks, { type: mimeType })
          if (blob.size < 1200) { listenRef.current(); return }
          const form = new FormData()
          form.append('audio', blob, 'speech.webm')
          form.append('language', (inputOverrideRef.current || languageLocales[currentLanguage.current]).split('-')[0])
          if (token) form.append('token', token)
          else if (agentId) form.append('agent_id', agentId)
          try {
            const res = await fetch('/api/voice/transcribe', { method: 'POST', body: form })
            if (res.status === 501) {
              whisperEnabled.current = false
              listenRef.current()
              return
            }
            if (!res.ok) { listenRef.current(); return }
            const data = (await res.json()) as { text?: string }
            const spoken = (data.text || '').trim()
            if (spoken && active.current && phaseRef.current === 'listening') {
              void turnRef.current(spoken)
            } else if (active.current && phaseRef.current === 'listening') {
              listenRef.current()
            }
          } catch {
            if (active.current && phaseRef.current === 'listening') listenRef.current()
          }
        }
        recorder.start(250)
        return
      } catch {
        whisperEnabled.current = false
      }
    }

    const Ctor = recognitionType()
    if (!Ctor) return
    const rec = new Ctor()
    recognition.current = rec
    rec.lang = inputOverrideRef.current || languageLocales[currentLanguage.current]; rec.continuous = false; rec.interimResults = true
    let text = ''
    let interimText = ''
    let failed = false
    let silenceTimer: ReturnType<typeof setTimeout> | null = null
    const commitSpeech = (spoken: string) => {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
      const cleaned = spoken.trim()
      if (cleaned && active.current && !mute.current && recognition.current === rec) {
        text = cleaned
        void turnRef.current(cleaned)
      }
    }
    rec.onresult = event => {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
      const results = Array.from(event.results)
      const finalText = results.filter(result => result.isFinal).map(result => result[0].transcript).join(' ').trim()
      interimText = results.map(result => result[0].transcript).join(' ').trim()
      if (finalText) {
        commitSpeech(finalText)
        return
      }
      if (interimText) {
        silenceTimer = setTimeout(() => commitSpeech(interimText), 750)
      }
    }
    rec.onerror = event => {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
      if (event.error === 'no-speech' || event.error === 'aborted') return
      failed = true
      setError(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Allow microphone and speech recognition access in your browser, then start a new call.'
        : 'Voice recognition stopped. Check your connection and try unmuting the microphone.')
      mute.current = true; setMuted(true)
    }
    rec.onend = () => {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
      if (!active.current || mute.current || failed || recognition.current !== rec) return
      if (text || interimText) { commitSpeech(text || interimText); return }
      retryTimer.current = setTimeout(() => listenRef.current(), 50)
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
    pushTurn({ speaker: 'caller', text })
    changePhase('thinking')
    const session = generation.current
    try {
      const { reply, playback } = await converse()
      if (!active.current || session !== generation.current) return
      await playback
      if (active.current && session === generation.current) { pushTurn({ speaker: 'agent', text: reply }); pendingSpoken.current = ''; setStreamingReply(''); listenRef.current() }
    } catch (err) {
      if (!active.current || session !== generation.current) return
      generation.current++; request.current?.abort(); window.speechSynthesis.cancel(); finishSpeech.current?.()
      if (pendingSpoken.current) { pushTurn({ speaker: 'agent', text: pendingSpoken.current }); pendingSpoken.current = ''; setStreamingReply('') }
      setError(err instanceof Error ? err.message : 'Connection interrupted.')
      listenRef.current()
    }
  }

  async function startCall() {
    if (active.current || saving || previewing) return
    console.log('[voice-call] Starting call — Mode: legacy', { agentId: agentId ?? null, hasToken: Boolean(token) })
    const session = ++generation.current
    active.current = true; mute.current = false; setMuted(false)
    history.current = []; setMessages([]); setStreamingReply(''); setError(''); setNote(''); setElapsed(0); setBookingDraft(null); setHighlighted([])
    started.current = Date.now(); changePhase('connecting')
    // Start realistic phone ringtone immediately inside the user click gesture
    ringtoneRef.current ??= createCallRingtone()
    ringtoneRef.current.start()
    // Prime speech synthesis during the user gesture for mobile browsers.
    window.speechSynthesis.resume()
    try {
      speaker.current ??= new Audio(); await primeSpeaker(speaker.current)
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (!active.current || session !== generation.current) { media.getTracks().forEach(t => t.stop()); return }
      stream.current = media
      startMeter(media)
      const { reply, playback } = await converse()
      if (!active.current || session !== generation.current) return
      await playback
      if (active.current && session === generation.current) { pushTurn({ speaker: 'agent', text: reply }); pendingSpoken.current = ''; setStreamingReply(''); listenRef.current() }
    } catch (err) {
      if (session !== generation.current) return
      active.current = false; stopAudio(); changePhase('idle')
      setError(err instanceof Error ? err.message : 'Please allow microphone access and try again.')
    }
  }

  async function endCall() {
    if (!active.current) return
    active.current = false; generation.current++; request.current?.abort()
    stopAudio(); changePhase('idle'); setElapsed(0)
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
    if (phaseRef.current !== 'speaking' && phaseRef.current !== 'buffering') return
    if (pendingSpoken.current) pushTurn({ speaker: 'agent', text: pendingSpoken.current })
    pendingSpoken.current = ''; setStreamingReply(''); generation.current++; request.current?.abort(); window.speechSynthesis.cancel(); finishSpeech.current?.(); listenRef.current()
  }
  interruptRef.current = interrupt

  async function handleSpeakerClick() {
    speaker.current ??= new Audio()
    const result = await audioOutput.handleSpeakerAction(async (deviceId) => {
      const el = speaker.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
      if (el?.setSinkId) {
        await el.setSinkId(deviceId)
      }
    })
    if (result.switchedTo) {
      setOutputNotice(`Speaker: ${result.switchedTo}`)
      if (outputNoticeTimer.current) clearTimeout(outputNoticeTimer.current)
      outputNoticeTimer.current = setTimeout(() => setOutputNotice(''), 2200)
    } else {
      if (speaker.current) speaker.current.muted = result.muted
      if (result.muted) window.speechSynthesis?.cancel()
    }
  }

  const inCall = phase !== 'idle' && phase !== 'ended'
  const label =
    phase === 'listening' && muted
      ? 'Muted'
      : phase === 'listening' && customerSpeaking
        ? 'Listening'
        : ({
            idle: 'Ready to call',
            connecting: 'Connecting…',
            listening: 'Connected',
            thinking: 'Thinking…',
            buffering: 'Connecting…',
            speaking: 'Speaking',
            ended: 'Ready to call',
          })[phase]
  const legacyOrbPhase: CloudOrbPhase =
    previewAudible || phase === 'speaking'
      ? 'speaking'
      : phase === 'connecting'
        ? 'connecting'
        : phase === 'thinking' || phase === 'buffering'
          ? 'thinking'
          : phase === 'listening' && customerSpeaking && !muted
            ? 'customer-speaking'
            : phase === 'listening'
              ? 'listening'
              : 'idle'

  const selection = selectBrowserVoice(voices, language, preset, voiceUri)
  const orderedDoctors = [...doctors].sort((a, b) => Number(highlighted.includes(b.id)) - Number(highlighted.includes(a.id)))
  function askDoctor(doctor: PublicDoctor) {
    if (!active.current || phaseRef.current === 'thinking' || phaseRef.current === 'connecting') return
    if (phaseRef.current === 'speaking') interrupt()
    void turnRef.current(localized(currentLanguage.current, `Tell me about ${doctor.name}`, `\u0645\u062c\u06be\u06d2 ${doctor.name} \u06a9\u06d2 \u0628\u0627\u0631\u06d2 \u0645\u06cc\u06ba \u0628\u062a\u0627\u0626\u06cc\u06ba`, `${doctor.name} \u0628\u0627\u0631\u06d2 \u062f\u0633\u0648`, `${doctor.name} \u0915\u0947 \u092c\u093e\u0930\u0947 \u092e\u0947\u0902 \u092c\u0924\u093e\u090f\u0901`))
  }
  function copyTranscript() {
    const all = [...messages, ...(streamingReply ? [{ speaker: 'agent' as const, text: streamingReply }] : [])]
    const formatted = all.map(m => `${m.speaker === 'caller' ? 'Caller' : 'Agent'}: ${m.text}`).join('\n')
    if (!formatted) return
    void navigator.clipboard?.writeText(formatted).then(() => {
      setCopiedChat(true)
      setTimeout(() => setCopiedChat(false), 1800)
    })
  }

  return (
    <section className="clinic-call-shell mx-auto w-full max-w-7xl text-brand-text">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="space-y-5 lg:sticky lg:top-6">
          <div className="relative flex min-h-[580px] flex-col items-center justify-between rounded-[2rem] border border-brand-border/70 bg-brand-bg px-5 pb-8 pt-7 text-center sm:min-h-[620px] sm:px-8 sm:py-10">
            <span
              data-voice-mode="legacy"
              className="absolute right-4 top-4 rounded-full border border-brand-border/70 bg-brand-surface/80 px-2.5 py-0.5 font-data text-[10px] text-brand-muted"
            >
              Mode: legacy
            </span>

            <header className="pt-2">
              <h1 className="font-display text-2xl font-medium tracking-tight text-brand-text sm:text-[1.85rem]">
                {clinic?.clinic_name || name || 'Clinic Reception'}
              </h1>
              {inCall && (
                <p className="mt-1 font-data text-xs tabular-nums text-brand-muted">
                  {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
                </p>
              )}
            </header>

            <div ref={orbRef} className="my-auto flex flex-col items-center py-6">
              <CloudOrb
                phase={legacyOrbPhase}
                muted={muted}
                micLevelRef={audioLevelRef}
                agentLevelRef={agentAudioLevelRef}
              />

              <p
                role="status"
                aria-live="polite"
                className="mt-9 flex items-center justify-center gap-2 text-base font-normal text-brand-text/85"
              >
                <span
                  className={`size-2 rounded-full ${
                    phase === 'connecting' || phase === 'speaking' || customerSpeaking
                      ? 'animate-pulse bg-brand-teal'
                      : inCall && !muted
                        ? 'bg-brand-teal'
                        : 'bg-brand-teal/55'
                  }`}
                />
                {previewAudible ? 'Voice preview' : label}
              </p>

              {outputNotice && <p className="mt-2 font-data text-[11px] text-brand-muted">{outputNotice}</p>}
              {!audioOutput.canSwitchOutput && audioOutput.agentAudioMuted && (
                <p className="mt-2 text-xs text-brand-muted">Agent audio muted</p>
              )}
              {phase === 'speaking' && (
                <button
                  type="button"
                  onClick={interrupt}
                  className="mt-3 rounded-full border border-brand-border bg-brand-surface px-4 py-1.5 text-xs text-brand-muted hover:bg-brand-surface-raised"
                >
                  Tap to speak
                </button>
              )}
            </div>

            <div className="flex w-full flex-col items-center gap-4">
              {!supported && <p role="alert" className="text-sm text-red-700">Open in Chrome or Edge and allow microphone access for audio calls.</p>}
              {error && <p role="alert" className="w-full max-w-sm rounded-2xl border border-red-200 bg-red-50/90 p-3 text-xs text-red-800">{error}</p>}
              {audioProblem && lastReplyText.current && <button type="button" onClick={replayAudio} className="rounded-full border border-brand-text bg-brand-text px-4 py-2 text-xs text-brand-bg">Enable audio / replay</button>}
              {note && <p role="status" className="text-xs text-brand-muted">{note}</p>}
              {highlighted.length > 0 && doctors.some(doctor => highlighted.includes(doctor.id)) && <button type="button" onClick={() => document.getElementById(`doctor-${highlighted[0]}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })} className="rounded-full border border-brand-teal bg-brand-teal/15 px-4 py-2 text-xs">View doctor profile</button>}

              <div className="flex items-center justify-center gap-7 sm:gap-9">
                <button
                  type="button"
                  onClick={toggleMute}
                  disabled={!inCall}
                  aria-label={inCall ? (muted ? 'Unmute microphone' : 'Mute microphone') : 'Microphone unavailable until call starts'}
                  aria-pressed={inCall ? muted : undefined}
                  title={muted ? 'Unmute microphone' : 'Mute microphone'}
                  className={`flex size-14 items-center justify-center rounded-full transition-all sm:size-16 ${
                    !inCall
                      ? 'bg-[#ECE5D5] text-brand-text/40'
                      : muted
                        ? 'bg-brand-text text-brand-bg hover:scale-105 active:scale-95'
                        : 'bg-[#ECE5D5] text-brand-text hover:scale-105 hover:bg-[#e3dac6] active:scale-95'
                  }`}
                >
                  {muted ? <MicOff className="size-5 sm:size-6" strokeWidth={1.75} /> : <Mic className="size-5 sm:size-6" strokeWidth={1.75} />}
                </button>

                {inCall ? (
                  <button
                    type="button"
                    onClick={endCall}
                    aria-label="End call"
                    title="End call"
                    className="flex size-16 items-center justify-center rounded-full bg-[#B5422D] text-white shadow-md transition-transform hover:scale-105 hover:bg-[#9f3825] active:scale-95 sm:size-[68px]"
                  >
                    <PhoneOff className="size-6" strokeWidth={1.9} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startCall}
                    disabled={!name || !supported || saving || previewing}
                    aria-label="Start call"
                    title="Start call"
                    className="flex size-16 items-center justify-center rounded-full bg-[#5B7760] text-white shadow-md transition-transform hover:scale-105 hover:bg-[#4e6853] active:scale-95 disabled:opacity-45 sm:size-[68px]"
                  >
                    {saving ? <Loader2 className="size-6 animate-spin" /> : <Phone className="size-6" strokeWidth={1.9} />}
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSpeakerClick}
                  aria-label={audioOutput.ariaLabel}
                  aria-pressed={!audioOutput.canSwitchOutput ? audioOutput.agentAudioMuted : undefined}
                  title={audioOutput.ariaLabel}
                  className={`flex size-14 items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95 sm:size-16 ${
                    !audioOutput.canSwitchOutput && audioOutput.agentAudioMuted
                      ? 'bg-brand-text text-brand-bg'
                      : 'bg-[#ECE5D5] text-brand-text hover:bg-[#e3dac6]'
                  }`}
                >
                  {!audioOutput.canSwitchOutput && audioOutput.agentAudioMuted ? (
                    <VolumeX className="size-5 sm:size-6" strokeWidth={1.75} />
                  ) : (
                    <Volume2 className="size-5 sm:size-6" strokeWidth={1.75} />
                  )}
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-1 text-xs text-brand-muted">
                <label className="flex items-center gap-2 rounded-full border border-brand-border/80 bg-brand-surface px-3 py-1.5 text-[11px]">
                  <Mic className="size-3" />
                  <select aria-label="Microphone listening language" disabled={inCall && phase !== 'listening'} value={inputOverride || languageLocales[language]} onChange={event => changeListeningLanguage(event.target.value)} className="max-w-32 bg-transparent font-medium text-brand-text outline-none">
                    <option value="ur-PK">Urdu</option>
                    <option value="en-US">English</option>
                    <option value="pa-PK">Punjabi</option>
                    <option value="hi-IN">Hindi</option>
                  </select>
                </label>
                {responseTime !== null && <span className="font-data text-[10px] uppercase tracking-wider">{responseTime.toFixed(1)}s</span>}
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-medium">Live conversation chat</h2>
                <p className="mt-0.5 text-xs text-brand-muted">Temporary transcript to review model accuracy.</p>
              </div>
              <button
                type="button"
                onClick={copyTranscript}
                disabled={messages.length === 0 && !streamingReply}
                className="rounded-full border border-brand-border px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-brand-bg"
              >
                {copiedChat ? 'Copied' : 'Copy chat'}
              </button>
            </div>
            <div className="max-h-72 space-y-2.5 overflow-y-auto rounded-xl border border-brand-border/70 bg-brand-bg/60 p-3">
              {messages.length === 0 && !streamingReply ? (
                <p className="py-6 text-center text-xs text-brand-muted">Start the call to see live caller &amp; agent messages here.</p>
              ) : (
                <>
                  {messages.map((turn, index) => (
                    <div
                      key={`${turn.speaker}-${index}`}
                      className={`flex flex-col ${turn.speaker === 'caller' ? 'items-end' : 'items-start'}`}
                    >
                      <span className="mb-1 font-data text-[9px] uppercase tracking-widest text-brand-muted">
                        {turn.speaker === 'caller' ? 'You' : name || 'Agent'}
                      </span>
                      <div
                        dir="auto"
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                          turn.speaker === 'caller'
                            ? 'bg-brand-text text-brand-bg'
                            : 'border border-brand-border bg-brand-surface text-brand-text'
                        }`}
                      >
                        {turn.text}
                      </div>
                    </div>
                  ))}
                  {streamingReply && (
                    <div className="flex flex-col items-start">
                      <span className="mb-1 font-data text-[9px] uppercase tracking-widest text-brand-muted">
                        {name || 'Agent'} (speaking)
                      </span>
                      <div dir="auto" className="max-w-[85%] rounded-2xl border border-brand-border bg-brand-surface px-3.5 py-2 text-sm leading-relaxed text-brand-text">
                        {streamingReply}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-display text-base font-medium">Choose the voice's tone</h2><p className="mt-1 text-xs text-brand-muted">Language follows the conversation. Tone is your choice.</p></div><button disabled={inCall || !supported || !name || previewing} onClick={previewVoice} className="rounded-full border border-brand-border px-3 py-2 text-xs disabled:opacity-40">{previewing ? 'Playing...' : 'Preview'}</button></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{voicePresets.map(item => <button key={item.id} onClick={() => changeVoice(item.id)} aria-pressed={preset === item.id} className={`rounded-xl border p-3 text-left transition-colors ${preset === item.id ? 'border-brand-text bg-brand-text text-brand-bg' : 'border-brand-border hover:bg-brand-bg'}`}><p className="text-xs font-medium">{item.label}</p><p className={`mt-1 text-[10px] ${preset === item.id ? 'text-brand-bg/70' : 'text-brand-muted'}`}>{item.detail}</p></button>)}</div>
            <p className="mt-3 text-[11px] leading-relaxed text-brand-muted">{audioProvider === 'online' ? 'Online neural speech. Urdu uses Uzma (female) or Asad (male); tone presets adjust delivery. Youthful is a style, not a child recording.' : !selection.languageAvailable ? 'No matching voice is installed for this language. Audio pronunciation may be limited; install a matching system voice.' : !selection.styleAvailable ? `Using ${selection.voice?.name}. This device has no matching gender-labelled voice; the preset adjusts tone and speed.` : `Native voice: ${selection.voice?.name || 'System default'}. Youthful is a tone preset, not a recorded child voice.`}</p>
            <details className="mt-3 text-xs text-brand-muted"><summary className="cursor-pointer">Device voice and speech input settings</summary><div className="mt-3 grid gap-3"><label className="grid gap-1.5">Fallback device voice<select value={voiceUri} onChange={event => { setVoiceUri(event.target.value); voiceUriRef.current = event.target.value; try { localStorage.setItem('voxa-native-voice', event.target.value) } catch {} }} className="w-full rounded-lg border border-brand-border bg-brand-bg p-2"><option value="">Automatic for this language</option>{voices.filter(voice => voice.lang.split('-')[0] === language).map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}</select></label><label className="grid gap-1.5">Speech input fallback<select value={inputOverride} onChange={event => changeListeningLanguage(event.target.value)} className="rounded-lg border border-brand-border bg-brand-bg p-2"><option value="">Automatic / current conversation</option><option value="en-US">English</option><option value="ur-PK">Urdu</option><option value="pa-PK">Punjabi (Pakistan)</option><option value="hi-IN">Hindi</option></select></label><p>Browser recognition uses one listening language at a time. If your first words are misheard, choose the input fallback. Replies adapt to the recognized language.</p></div></details>
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
