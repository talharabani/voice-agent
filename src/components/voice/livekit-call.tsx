'use client';

import { useEffect, useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useRoomContext,
  useVoiceAssistant,
} from '@livekit/components-react';
import { Loader2, Mic, MicOff, Phone, PhoneOff, ShieldCheck, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Waveform } from '@/components/voice/waveform';
import { VoxaOrb3D } from '@/components/three/voxa-orb-3d';

type ConnectionSession = {
  serverUrl: string;
  roomName: string;
  token: string;
};

type CallUiState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended';

export function LiveKitCall({ agentId, token }: { agentId?: string; token?: string }) {
  const [session, setSession] = useState<ConnectionSession | null>(null);
  const [uiState, setUiState] = useState<CallUiState>('idle');
  const [error, setError] = useState('');

  async function startCall() {
    if (uiState === 'connecting' || session) return;
    console.log('[voice-call] Starting call — Mode: livekit', {
      agentId: agentId ?? null,
      hasToken: Boolean(token),
    });
    setError('');
    setUiState('connecting');
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
      setSession({
        serverUrl: data.serverUrl,
        roomName: data.roomName,
        token: data.token,
      });
    } catch (err) {
      setUiState('idle');
      setError(err instanceof Error ? err.message : 'Connection failed.');
    }
  }

  function handleDisconnected() {
    setSession(null);
    setUiState('ended');
  }

  function handleRoomError(err: Error) {
    const msg = err.message || 'Connection failed.';
    if (/permission|notallowed|denied/i.test(msg)) {
      setError('Microphone permission denied. Please allow mic access in your browser and try again.');
    } else {
      setError(msg);
    }
    setSession(null);
    setUiState('ended');
  }

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
          <div className="flex items-center gap-2 rounded-full border border-brand-border bg-brand-surface-raised px-3 py-2 text-xs">
            <span
              className={`size-2 rounded-full ${
                session ? 'animate-pulse bg-brand-teal' : 'bg-brand-muted/50'
              }`}
            />
            {session ? 'Connected' : uiState === 'connecting' ? 'Connecting' : 'Ready'}
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
          onDisconnected={handleDisconnected}
          onError={handleRoomError}
          onMediaDeviceFailure={() =>
            handleRoomError(new Error('Microphone permission denied or device unavailable.'))
          }
        >
          <RoomAudioRenderer />
          <ActiveRoomView onEndCall={handleDisconnected} />
        </LiveKitRoom>
      ) : (
        <div className="clinic-voice-room relative flex min-h-[520px] flex-col items-center justify-between overflow-hidden rounded-[2rem] border border-brand-border bg-brand-surface p-6 text-center sm:p-8">
          <div className="relative z-10 flex w-full items-center justify-between">
            <span className="flex items-center gap-2 font-data text-[10px] uppercase tracking-[.18em]">
              <Waveform />
              VOXA / LiveKit WebRTC
            </span>
            <span className="flex items-center gap-1.5 text-xs text-brand-muted">
              <ShieldCheck className="size-3.5" />
              Realtime voice
            </span>
          </div>

          <div className="relative z-10 flex flex-col items-center py-6">
            <p className="font-data text-[10px] uppercase tracking-[.24em] text-brand-muted">
              Instant speech-to-speech
            </p>
            <h1 className="mt-3 font-display text-3xl tracking-tight sm:text-4xl">
              Clinic Reception
            </h1>
            <div className="voice-orbit clinic-orbit my-8" aria-hidden="true">
              <VoxaOrb3D phase={uiState === 'connecting' ? 'connecting' : uiState === 'ended' ? 'ended' : 'idle'} />
            </div>
            <p role="status" aria-live="polite" className="text-base">
              {uiState === 'connecting'
                ? 'Connecting to reception...'
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
              className="h-14 rounded-full px-8 text-base"
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

function ActiveRoomView({ onEndCall }: { onEndCall: () => void }) {
  const room = useRoomContext();
  const { state, agentTranscriptions } = useVoiceAssistant();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const [muted, setMuted] = useState(false);

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

  const orbPhase =
    state === 'speaking'
      ? 'speaking'
      : state === 'thinking'
        ? 'thinking'
        : state === 'listening'
          ? 'listening'
          : 'connecting';

  const statusLabel =
    muted || !isMicrophoneEnabled
      ? 'Microphone muted'
      : state === 'speaking'
        ? 'Agent speaking'
        : state === 'thinking'
          ? 'Thinking...'
          : state === 'listening'
            ? 'Listening to you'
            : 'Connecting to agent...';

  return (
    <div className="space-y-5">
      <div className="clinic-voice-room relative flex min-h-[520px] flex-col items-center justify-between overflow-hidden rounded-[2rem] border border-brand-border bg-brand-surface p-6 text-center sm:p-8">
        <div className="relative z-10 flex w-full items-center justify-between">
          <span className="flex items-center gap-2 font-data text-[10px] uppercase tracking-[.18em]">
            <Waveform />
            VOXA / LiveKit WebRTC
          </span>
          <span className="font-data text-[10px] uppercase tracking-widest text-brand-muted">
            {state}
          </span>
        </div>

        <div className="relative z-10 flex flex-col items-center py-6">
          <div className="voice-orbit clinic-orbit my-6" aria-hidden="true">
            <VoxaOrb3D phase={orbPhase} muted={muted} />
          </div>
          <p role="status" aria-live="polite" className="text-base font-medium">
            {statusLabel}
          </p>
        </div>

        <div className="relative z-10 flex items-center justify-center gap-5">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={muted}
            className={`flex size-14 items-center justify-center rounded-full border border-brand-border ${
              muted ? 'bg-brand-text text-brand-bg' : 'bg-brand-bg'
            }`}
          >
            {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </button>
          <button
            type="button"
            onClick={endCall}
            aria-label="End call"
            className="flex size-16 items-center justify-center rounded-full bg-[#B74434] text-white shadow-lg hover:bg-[#9c382b]"
          >
            <PhoneOff className="size-6" />
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-brand-border bg-brand-surface p-5">
        <h2 className="font-display text-base font-medium">Live agent transcript</h2>
        <div className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-brand-border/70 bg-brand-bg/60 p-3">
          {agentTranscriptions.length === 0 ? (
            <p className="py-4 text-center text-xs text-brand-muted">
              Agent responses will appear here as it speaks.
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
        </div>
      </div>
    </div>
  );
}
