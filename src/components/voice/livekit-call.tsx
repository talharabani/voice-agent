'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionState, type LocalAudioTrack } from 'livekit-client';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
  useMultibandTrackVolume,
  useRoomContext,
  useVoiceAssistant,
} from '@livekit/components-react';
import {
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Volume2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Waveform } from '@/components/voice/waveform';
import { CallOrb } from '@/components/voice/call-orb';
import { CallVisualizer, type VisualizerMode } from '@/components/voice/call-visualizer';
import type { OrbPhase } from '@/components/three/voxa-orb-3d';
import { createCallRingtone, type CallRingtone } from '@/lib/voice/ringtone';

type ConnectionSession = {
  serverUrl: string;
  roomName: string;
  token: string;
};

type CallUiState = 'idle' | 'connecting' | 'ringing' | 'connected' | 'ended';

const LIVEKIT_ROOM_OPTIONS = {
  audioCaptureDefaults: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  dynacast: true,
};

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function LiveKitCall({ agentId, token }: { agentId?: string; token?: string }) {
  const [session, setSession] = useState<ConnectionSession | null>(null);
  const [uiState, setUiState] = useState<CallUiState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const ringtoneRef = useRef<CallRingtone | null>(null);
  const connectedAtRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      ringtoneRef.current?.dispose();
      ringtoneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (uiState !== 'connected') return;
    connectedAtRef.current = Date.now();
    setElapsed(0);
    const timer = setInterval(() => {
      if (connectedAtRef.current) {
        setElapsed(Math.floor((Date.now() - connectedAtRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [uiState]);

  const stopRingtone = useCallback((playChime = false) => {
    ringtoneRef.current?.stop({ playChime });
  }, []);

  const handleAgentConnected = useCallback(() => {
    stopRingtone(true);
    setUiState('connected');
  }, [stopRingtone]);

  async function startCall() {
    if (uiState === 'connecting' || uiState === 'ringing' || session) return;
    console.log('[voice-call] Starting call — Mode: livekit', {
      agentId: agentId ?? null,
      hasToken: Boolean(token),
    });
    setError('');
    setElapsed(0);
    setUiState('connecting');

    // Unlock and start realistic ringtone immediately inside the user gesture
    ringtoneRef.current ??= createCallRingtone();
    ringtoneRef.current.start();

    try {
      const res = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(token ? { token } : { agent_id: agentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Could not start LiveKit call.');
      }
      setUiState('ringing');
      setSession({
        serverUrl: data.serverUrl,
        roomName: data.roomName,
        token: data.token,
      });
    } catch (err) {
      stopRingtone(false);
      setUiState('idle');
      setError(err instanceof Error ? err.message : 'Connection failed.');
    }
  }

  const handleDisconnected = useCallback(() => {
    stopRingtone(false);
    connectedAtRef.current = null;
    setSession(null);
    setUiState('ended');
  }, [stopRingtone]);

  const handleRoomError = useCallback(
    (err: Error) => {
      stopRingtone(false);
      connectedAtRef.current = null;
      const msg = err.message || 'Connection failed.';
      if (/permission|notallowed|denied/i.test(msg)) {
        setError('Microphone permission denied. Please allow mic access in your browser and try again.');
      } else {
        setError(msg);
      }
      setSession(null);
      setUiState('ended');
    },
    [stopRingtone]
  );

  const headerDotClass =
    uiState === 'connected'
      ? 'animate-pulse bg-emerald-500'
      : uiState === 'connecting' || uiState === 'ringing'
        ? 'animate-ping bg-amber-500'
        : 'bg-brand-muted/50';

  const headerLabel =
    uiState === 'connected'
      ? `Connected · ${formatDuration(elapsed)}`
      : uiState === 'ringing'
        ? 'Ringing...'
        : uiState === 'connecting'
          ? 'Connecting to agent'
          : uiState === 'ended'
            ? 'Call ended'
            : 'Ready';

  return (
    <section className="clinic-call-shell mx-auto w-full max-w-4xl text-brand-text">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-brand-border bg-brand-surface px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-brand-teal/20">
            <Stethoscope className="size-5" />
          </div>
          <div>
            <p className="font-display text-lg font-semibold">LiveKit Realtime Reception</p>
            <p className="mt-0.5 font-data text-[10px] uppercase tracking-[.18em] text-brand-muted">
              WebRTC Low-Latency Voice
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-voice-mode="livekit"
            className="rounded-full border border-brand-border bg-brand-surface-raised px-2.5 py-1.5 font-data text-[11px] font-medium text-brand-muted"
          >
            Mode: livekit
          </span>
          <div className="flex items-center gap-2 rounded-full border border-brand-border bg-brand-surface-raised px-3 py-2 text-xs tabular-nums">
            <span className="relative flex size-2">
              <span className={`inline-flex size-2 rounded-full ${headerDotClass}`} />
            </span>
            {headerLabel}
          </div>
        </div>
      </header>

      {session ? (
        <LiveKitRoom
          serverUrl={session.serverUrl}
          token={session.token}
          connect={true}
          audio={true}
          video={false}
          options={LIVEKIT_ROOM_OPTIONS}
          onDisconnected={handleDisconnected}
          onError={handleRoomError}
          onMediaDeviceFailure={() =>
            handleRoomError(new Error('Microphone permission denied or device unavailable.'))
          }
        >
          <RoomAudioRenderer />
          <ActiveRoomView
            elapsed={elapsed}
            onAgentConnected={handleAgentConnected}
            onEndCall={handleDisconnected}
          />
        </LiveKitRoom>
      ) : (
        <div className="clinic-voice-room relative flex min-h-[540px] flex-col items-center justify-between overflow-hidden rounded-[2rem] border border-brand-border bg-brand-surface p-6 text-center transition-colors duration-300 sm:p-8">
          <div className="relative z-10 flex w-full items-center justify-between">
            <span className="flex items-center gap-2 font-data text-[10px] uppercase tracking-[.18em]">
              <Waveform active={uiState === 'connecting'} />
              VOXA / LiveKit WebRTC
            </span>
            <span className="flex items-center gap-1.5 text-xs text-brand-muted">
              <ShieldCheck className="size-3.5" />
              Realtime voice
            </span>
          </div>

          <div className="relative z-10 flex flex-col items-center py-4">
            <p className="font-data text-[10px] uppercase tracking-[.24em] text-brand-muted">
              Instant speech-to-speech
            </p>
            <h1 className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">
              Clinic Reception
            </h1>

            <div
              data-phase={uiState === 'connecting' ? 'connecting' : uiState === 'ended' ? 'ended' : 'idle'}
              className="call-orb-stage my-6"
              aria-hidden="true"
            >
              <span className="call-orb-glow" />
              <span className="call-orb-ring" />
              {uiState === 'connecting' && (
                <>
                  <span className="call-connect-arc call-connect-arc-amber" />
                  <span className="call-ring-ripple call-ring-ripple-amber" />
                  <span className="call-ring-ripple call-ring-ripple-amber call-ring-ripple-delay" />
                </>
              )}
              <CallOrb phase={uiState === 'connecting' ? 'connecting' : uiState === 'ended' ? 'ended' : 'idle'} />
            </div>

            <CallVisualizer mode={uiState === 'connecting' ? 'connecting' : uiState === 'ended' ? 'ended' : 'idle'} />

            <p role="status" aria-live="polite" className="mt-4 flex items-center gap-2 text-base font-medium">
              {uiState === 'connecting' && <PhoneCall className="call-phone-ringing size-4 text-amber-600" />}
              {uiState === 'connecting'
                ? 'Connecting to agent...'
                : uiState === 'ended'
                  ? 'Call ended'
                  : 'Click Call to speak with reception in real time.'}
            </p>
          </div>

          <div className="relative z-10 flex w-full flex-col items-center gap-4">
            {error && (
              <p role="alert" className="w-full max-w-md rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </p>
            )}
            <Button
              onClick={startCall}
              disabled={uiState === 'connecting'}
              className="h-14 rounded-full px-8 text-base shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {uiState === 'connecting' ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Phone className="size-5" />
              )}
              {uiState === 'connecting'
                ? 'Connecting...'
                : uiState === 'ended'
                  ? 'Call again'
                  : 'Call'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function ActiveRoomView({
  elapsed,
  onAgentConnected,
  onEndCall,
}: {
  elapsed: number;
  onAgentConnected: () => void;
  onEndCall: () => void;
}) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const { state, audioTrack, agentTranscriptions } = useVoiceAssistant();
  const { localParticipant, isMicrophoneEnabled, microphoneTrack } = useLocalParticipant();
  const [muted, setMuted] = useState(false);
  const [customerSpeaking, setCustomerSpeaking] = useState(false);
  const agentConnectedNotifiedRef = useRef(false);
  const audioLevelRef = useRef(0);
  const speechHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const localMicTrack = microphoneTrack?.track as LocalAudioTrack | undefined;

  const agentBands = useMultibandTrackVolume(audioTrack, {
    bands: 17,
    loPass: 35,
    hiPass: 450,
    updateInterval: 50,
  });

  const customerBands = useMultibandTrackVolume(localMicTrack, {
    bands: 17,
    loPass: 35,
    hiPass: 450,
    updateInterval: 50,
  });

  const isAgentReady =
    state === 'listening' || state === 'thinking' || state === 'speaking';

  // Stop the ringing tone immediately once the agent joins and becomes active
  useEffect(() => {
    if (isAgentReady && !agentConnectedNotifiedRef.current) {
      agentConnectedNotifiedRef.current = true;
      onAgentConnected();
    }
  }, [isAgentReady, onAgentConnected]);

  // Smooth customer-speaking detection with a short release hold so syllables don't flicker
  const customerLevel = useMemo(() => {
    if (!customerBands.length) return 0;
    const sum = customerBands.reduce((acc, v) => acc + v, 0);
    return sum / customerBands.length;
  }, [customerBands]);

  const agentLevel = useMemo(() => {
    if (!agentBands.length) return 0;
    const sum = agentBands.reduce((acc, v) => acc + v, 0);
    return sum / agentBands.length;
  }, [agentBands]);

  useEffect(() => {
    const activeListening = isAgentReady && state === 'listening' && !muted && isMicrophoneEnabled;
    if (!activeListening) {
      if (speechHoldTimerRef.current) {
        clearTimeout(speechHoldTimerRef.current);
        speechHoldTimerRef.current = null;
      }
      setCustomerSpeaking(false);
      return;
    }

    if (customerLevel > 0.055) {
      if (speechHoldTimerRef.current) {
        clearTimeout(speechHoldTimerRef.current);
        speechHoldTimerRef.current = null;
      }
      setCustomerSpeaking(true);
    } else if (customerSpeaking && !speechHoldTimerRef.current) {
      speechHoldTimerRef.current = setTimeout(() => {
        speechHoldTimerRef.current = null;
        setCustomerSpeaking(false);
      }, 320);
    }
  }, [customerLevel, customerSpeaking, isAgentReady, isMicrophoneEnabled, muted, state]);

  useEffect(() => {
    return () => {
      if (speechHoldTimerRef.current) clearTimeout(speechHoldTimerRef.current);
    };
  }, []);

  // Feed real-time level into the 3D orb ref (zero React re-renders for WebGL)
  if (state === 'speaking') {
    audioLevelRef.current = agentLevel;
  } else if (!muted && isMicrophoneEnabled) {
    audioLevelRef.current = customerLevel;
  } else {
    audioLevelRef.current = 0;
  }

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [agentTranscriptions.length]);

  useEffect(() => {
    return () => {
      void room.disconnect();
    };
  }, [room]);

  async function toggleMute() {
    const next = !muted;
    setMuted(next);
    await localParticipant.setMicrophoneEnabled(!next);
  }

  async function endCall() {
    await room.disconnect();
    onEndCall();
  }

  const isRinging = !isAgentReady && connectionState === ConnectionState.Connected;
  const isConnecting = !isAgentReady && connectionState !== ConnectionState.Connected;
  const isMutedState = muted || !isMicrophoneEnabled;

  const orbPhase: OrbPhase = isConnecting
    ? 'connecting'
    : isRinging
      ? 'ringing'
      : state === 'speaking'
        ? 'speaking'
        : state === 'thinking'
          ? 'thinking'
          : isMutedState
            ? 'listening'
            : customerSpeaking
              ? 'customer-speaking'
              : 'listening';

  const vizMode: VisualizerMode = isConnecting
    ? 'connecting'
    : isRinging
      ? 'ringing'
      : isMutedState
        ? 'muted'
        : state === 'speaking'
          ? 'agent-speaking'
          : state === 'thinking'
            ? 'thinking'
            : customerSpeaking
              ? 'customer-speaking'
              : 'silence';

  const activeBands =
    vizMode === 'agent-speaking'
      ? agentBands
      : vizMode === 'customer-speaking'
        ? customerBands
        : undefined;

  const statusLabel = isConnecting
    ? 'Connecting to agent...'
    : isRinging
      ? 'Ringing reception...'
      : isMutedState
        ? 'Microphone muted'
        : state === 'speaking'
          ? 'Agent is speaking'
          : state === 'thinking'
            ? 'Agent is thinking...'
            : customerSpeaking
              ? 'You are speaking'
              : 'Connected — speak naturally';

  const statusPillClass =
    vizMode === 'customer-speaking'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800'
      : vizMode === 'agent-speaking'
        ? 'border-brand-teal/50 bg-brand-teal/15 text-brand-text'
        : vizMode === 'ringing' || vizMode === 'connecting'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-800'
          : 'border-brand-border bg-brand-surface-raised text-brand-muted';

  const scenePhase = isMutedState
    ? 'muted'
    : vizMode === 'customer-speaking'
      ? 'customer-speaking'
      : vizMode === 'agent-speaking'
        ? 'speaking'
        : isRinging || isConnecting
          ? 'ringing'
          : state === 'thinking'
            ? 'thinking'
            : 'listening';

  return (
    <div className="space-y-5">
      <div className="clinic-voice-room relative flex min-h-[540px] flex-col items-center justify-between overflow-hidden rounded-[2rem] border border-brand-border bg-brand-surface p-6 text-center transition-all duration-300 sm:p-8">
        <div className="relative z-10 flex w-full items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-data text-[10px] uppercase tracking-[.18em]">
            <Waveform active={vizMode === 'agent-speaking' || vizMode === 'customer-speaking'} />
            VOXA / LiveKit WebRTC
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors duration-200 ${statusPillClass}`}
          >
            {isRinging || isConnecting ? (
              <PhoneCall className="call-phone-ringing size-3" />
            ) : vizMode === 'agent-speaking' ? (
              <Volume2 className="size-3 animate-pulse" />
            ) : vizMode === 'customer-speaking' ? (
              <Mic className="size-3 animate-pulse" />
            ) : vizMode === 'thinking' ? (
              <Sparkles className="size-3 animate-pulse" />
            ) : (
              <span className="size-1.5 rounded-full bg-current" />
            )}
            {isAgentReady ? `${formatDuration(elapsed)} · ${state}` : isRinging ? 'Ringing' : 'Connecting'}
          </span>
        </div>

        <div className="relative z-10 flex flex-col items-center py-4">
          <div className="mb-1 text-center">
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Clinic Reception
            </h1>
            <p className="mt-1 font-data text-xs tabular-nums text-brand-muted">
              {isAgentReady ? formatDuration(elapsed) : isRinging ? 'Ringing...' : 'Dialing...'}
            </p>
          </div>

          <div
            data-phase={scenePhase}
            className="call-orb-stage my-5"
            aria-hidden="true"
          >
            <span className="call-orb-glow" />
            <span className="call-orb-ring" />
            {isConnecting && <span className="call-connect-arc call-connect-arc-amber" />}
            {state === 'thinking' && !isConnecting && !isRinging && <span className="call-connect-arc" />}
            {isRinging && (
              <>
                <span className="call-ring-ripple call-ring-ripple-amber" />
                <span className="call-ring-ripple call-ring-ripple-amber call-ring-ripple-delay" />
              </>
            )}
            {vizMode === 'agent-speaking' && (
              <>
                <span className="call-ring-ripple" />
                <span className="call-ring-ripple call-ring-ripple-delay" />
              </>
            )}
            <CallOrb phase={orbPhase} muted={isMutedState} audioLevelRef={audioLevelRef} />
          </div>

          <CallVisualizer mode={vizMode} bands={activeBands} />

          <p role="status" aria-live="polite" className="mt-4 text-base font-medium transition-opacity duration-200">
            {statusLabel}
          </p>
          <p className="mt-1 text-xs text-brand-muted">
            {isRinging || isConnecting
              ? 'Waiting for clinic receptionist to pick up...'
              : vizMode === 'agent-speaking'
                ? 'You can interrupt anytime by speaking naturally.'
                : vizMode === 'customer-speaking'
                  ? 'Listening live...'
                  : 'Speak naturally — full-duplex audio is active.'}
          </p>
        </div>

        <div className="relative z-10 flex items-start justify-center gap-7 pt-2">
          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
              aria-pressed={muted}
              className={`flex size-14 items-center justify-center rounded-full border shadow-xs transition-all hover:scale-105 active:scale-95 ${
                muted
                  ? 'border-brand-text bg-brand-text text-brand-bg'
                  : customerSpeaking
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-800'
                    : 'border-brand-border bg-brand-surface-raised text-brand-text hover:bg-brand-bg'
              }`}
            >
              {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </button>
            <span className="font-data text-[10px] uppercase tracking-wider text-brand-muted">
              {muted ? 'Unmute' : 'Mute'}
            </span>
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={endCall}
              aria-label="End call"
              className="flex size-16 items-center justify-center rounded-full bg-[#C23B2B] text-white shadow-lg shadow-[#C23B2B]/25 transition-transform hover:scale-105 hover:bg-[#a83123] active:scale-95"
            >
              <PhoneOff className="size-6" />
            </button>
            <span className="font-data text-[10px] uppercase tracking-wider text-brand-muted">
              End
            </span>
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <span
              aria-label="Speaker active"
              className={`flex size-14 items-center justify-center rounded-full border shadow-xs transition-colors ${
                vizMode === 'agent-speaking'
                  ? 'border-brand-teal/60 bg-brand-teal/15 text-brand-text'
                  : 'border-brand-border bg-brand-surface-raised text-brand-muted'
              }`}
            >
              <Volume2 className={`size-5 ${vizMode === 'agent-speaking' ? 'animate-pulse' : ''}`} />
            </span>
            <span className="font-data text-[10px] uppercase tracking-wider text-brand-muted">
              Audio
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-brand-border bg-brand-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-medium">Live agent transcript</h2>
          {isAgentReady && (
            <span className="font-data text-[10px] uppercase tracking-widest text-brand-muted">
              {agentTranscriptions.length} {agentTranscriptions.length === 1 ? 'message' : 'messages'}
            </span>
          )}
        </div>
        <div className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-brand-border/70 bg-brand-bg/60 p-3">
          {agentTranscriptions.length === 0 ? (
            <p className="py-4 text-center text-xs text-brand-muted">
              {isRinging || isConnecting
                ? 'Connecting call — transcript will appear once the receptionist answers.'
                : 'Agent responses will appear here as it speaks.'}
            </p>
          ) : (
            agentTranscriptions.map((item, idx) => (
              <p
                key={item.id ?? idx}
                dir="auto"
                className="rounded-xl border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-text"
              >
                {item.text}
              </p>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      </div>
    </div>
  );
}
