'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionState, type LocalAudioTrack } from 'livekit-client';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
  useRoomContext,
  useTrackVolume,
  useVoiceAssistant,
} from '@livekit/components-react';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { CloudOrb, type CloudOrbPhase } from '@/components/voice/cloud-orb';
import { createCallRingtone, type CallRingtone } from '@/lib/voice/ringtone';
import { useAudioOutputControl } from '@/lib/voice/use-audio-output';

type ConnectionSession = {
  serverUrl: string;
  roomName: string;
  token: string;
};

type CallUiState = 'idle' | 'connecting' | 'ringing' | 'connected';

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
  const [clinicTitle, setClinicTitle] = useState('Clinic Reception');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const ringtoneRef = useRef<CallRingtone | null>(null);
  const connectedAtRef = useRef<number | null>(null);

  const audioOutput = useAudioOutputControl();

  // Non-blocking clinic name lookup (defaults immediately to "Clinic Reception")
  useEffect(() => {
    const endpoint = token
      ? `/api/public/call/${token}`
      : agentId
        ? `/api/agents/${agentId}`
        : null;
    if (!endpoint) return;
    let cancelled = false;
    fetch(endpoint)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const title = data.clinic?.clinic_name || data.agent?.name;
        if (typeof title === 'string' && title.trim()) {
          setClinicTitle(title.trim());
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agentId, token]);

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
    void audioOutput.refreshOutputs();
  }, [audioOutput, stopRingtone]);

  async function startCall() {
    if (uiState === 'connecting' || uiState === 'ringing' || session) return;
    console.log('[voice-call] Starting call — Mode: livekit', {
      agentId: agentId ?? null,
      hasToken: Boolean(token),
    });
    setError('');
    setElapsed(0);
    setUiState('connecting');

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

  const returnToIdle = useCallback(() => {
    stopRingtone(false);
    connectedAtRef.current = null;
    setSession(null);
    setElapsed(0);
    setUiState('idle');
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
      setElapsed(0);
      setUiState('idle');
    },
    [stopRingtone]
  );

  if (session) {
    return (
      <LiveKitRoom
        serverUrl={session.serverUrl}
        token={session.token}
        connect={true}
        audio={true}
        video={false}
        options={LIVEKIT_ROOM_OPTIONS}
        onDisconnected={returnToIdle}
        onError={handleRoomError}
        onMediaDeviceFailure={() =>
          handleRoomError(new Error('Microphone permission denied or device unavailable.'))
        }
      >
        <RoomAudioRenderer volume={audioOutput.agentAudioMuted ? 0 : 1} />
        <ActiveRoomView
          clinicTitle={clinicTitle}
          elapsed={elapsed}
          error={error}
          audioOutput={audioOutput}
          onAgentConnected={handleAgentConnected}
          onEndCall={returnToIdle}
        />
      </LiveKitRoom>
    );
  }

  const isConnecting = uiState === 'connecting';

  return (
    <section className="relative mx-auto flex min-h-[calc(100svh-5.5rem)] w-full max-w-md flex-col items-center justify-between px-5 pb-10 pt-8 text-center text-brand-text sm:py-12">
      <span
        data-voice-mode="livekit"
        className="absolute right-4 top-2 rounded-full border border-brand-border/70 bg-brand-surface/80 px-2.5 py-0.5 font-data text-[10px] text-brand-muted"
      >
        Mode: livekit
      </span>

      <header className="pt-4">
        <h1 className="font-display text-2xl font-medium tracking-tight text-brand-text sm:text-[1.85rem]">
          {clinicTitle}
        </h1>
      </header>

      <div className="my-auto flex flex-col items-center py-6">
        <CloudOrb phase={isConnecting ? 'connecting' : 'idle'} />

        <p
          role="status"
          aria-live="polite"
          className="mt-10 flex items-center justify-center gap-2 text-base font-normal text-brand-text/85"
        >
          <span
            className={`size-2 rounded-full ${
              isConnecting ? 'animate-pulse bg-brand-teal' : 'bg-brand-teal/60'
            }`}
          />
          {isConnecting ? 'Connecting…' : 'Ready to call'}
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 max-w-xs rounded-2xl border border-red-200 bg-red-50/90 px-4 py-2.5 text-xs text-red-800"
          >
            {error}
          </p>
        )}
      </div>

      <div className="flex w-full items-center justify-center gap-7 pb-2 sm:gap-9">
        <button
          type="button"
          disabled
          aria-label="Microphone unavailable until call starts"
          className="flex size-14 items-center justify-center rounded-full bg-[#ECE5D5] text-brand-text/40 sm:size-16"
        >
          <Mic className="size-5 sm:size-6" strokeWidth={1.75} />
        </button>

        {isConnecting ? (
          <button
            type="button"
            onClick={returnToIdle}
            aria-label="End call"
            className="flex size-16 items-center justify-center rounded-full bg-[#B5422D] text-white shadow-md transition-transform hover:scale-105 active:scale-95 sm:size-[68px]"
          >
            <Loader2 className="size-6 animate-spin" />
          </button>
        ) : (
          <button
            type="button"
            onClick={startCall}
            aria-label="Start call"
            className="flex size-16 items-center justify-center rounded-full bg-[#5B7760] text-white shadow-md transition-transform hover:scale-105 hover:bg-[#4e6853] active:scale-95 sm:size-[68px]"
          >
            <Phone className="size-6" strokeWidth={1.9} />
          </button>
        )}

        <button
          type="button"
          onClick={() => void audioOutput.handleSpeakerAction()}
          aria-label={audioOutput.ariaLabel}
          aria-pressed={!audioOutput.canSwitchOutput ? audioOutput.agentAudioMuted : undefined}
          title={audioOutput.ariaLabel}
          className={`flex size-14 items-center justify-center rounded-full transition-colors sm:size-16 ${
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
    </section>
  );
}

function ActiveRoomView({
  clinicTitle,
  elapsed,
  error,
  audioOutput,
  onAgentConnected,
  onEndCall,
}: {
  clinicTitle: string;
  elapsed: number;
  error: string;
  audioOutput: ReturnType<typeof useAudioOutputControl>;
  onAgentConnected: () => void;
  onEndCall: () => void;
}) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const { state, audioTrack, agentTranscriptions } = useVoiceAssistant();
  const { localParticipant, isMicrophoneEnabled, microphoneTrack } = useLocalParticipant();
  const [muted, setMuted] = useState(false);
  const [customerSpeaking, setCustomerSpeaking] = useState(false);
  const [outputNotice, setOutputNotice] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);

  const agentConnectedNotifiedRef = useRef(false);
  const micLevelRef = useRef(0);
  const agentLevelRef = useRef(0);
  const speechHoldRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const localMicTrack = microphoneTrack?.track as LocalAudioTrack | undefined;

  // Real-time Web Audio volume tracking for BOTH caller mic and clinic agent playback
  const agentVolume = useTrackVolume(audioTrack);
  const micVolume = useTrackVolume(localMicTrack);

  const isAgentReady =
    state === 'listening' || state === 'thinking' || state === 'speaking';

  useEffect(() => {
    if (isAgentReady && !agentConnectedNotifiedRef.current) {
      agentConnectedNotifiedRef.current = true;
      onAgentConnected();
    }
  }, [isAgentReady, onAgentConnected]);

  // Smooth customer-speaking indicator (short release hold prevents flicker between words)
  useEffect(() => {
    const activeListening =
      isAgentReady && state === 'listening' && !muted && isMicrophoneEnabled;
    if (!activeListening) {
      if (speechHoldRef.current) {
        clearTimeout(speechHoldRef.current);
        speechHoldRef.current = null;
      }
      setCustomerSpeaking(false);
      return;
    }

    if (micVolume > 0.05) {
      if (speechHoldRef.current) {
        clearTimeout(speechHoldRef.current);
        speechHoldRef.current = null;
      }
      setCustomerSpeaking(true);
    } else if (customerSpeaking && !speechHoldRef.current) {
      speechHoldRef.current = setTimeout(() => {
        speechHoldRef.current = null;
        setCustomerSpeaking(false);
      }, 300);
    }
  }, [customerSpeaking, isAgentReady, isMicrophoneEnabled, micVolume, muted, state]);

  useEffect(() => {
    return () => {
      if (speechHoldRef.current) clearTimeout(speechHoldRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  // Feed live levels straight into the orb shader refs (zero React re-renders per WebGL frame)
  micLevelRef.current = !muted && isMicrophoneEnabled ? micVolume : 0;
  agentLevelRef.current = audioOutput.agentAudioMuted ? 0 : agentVolume;

  useEffect(() => {
    if (showTranscript) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [agentTranscriptions.length, showTranscript]);

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

  async function handleSpeakerClick() {
    const result = await audioOutput.handleSpeakerAction(async (deviceId) => {
      await room.switchActiveDevice('audiooutput', deviceId);
    });
    if (result.switchedTo) {
      setOutputNotice(`Speaker: ${result.switchedTo}`);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => setOutputNotice(''), 2200);
    }
  }

  async function endCall() {
    try {
      await localParticipant.setMicrophoneEnabled(false);
    } catch {
      // Ignore track release errors during disconnect
    }
    await room.disconnect();
    onEndCall();
  }

  const isRinging = !isAgentReady && connectionState === ConnectionState.Connected;
  const isConnecting = !isAgentReady && connectionState !== ConnectionState.Connected;
  const isMutedState = muted || !isMicrophoneEnabled;

  const orbPhase: CloudOrbPhase = isConnecting
    ? 'connecting'
    : isRinging
      ? 'ringing'
      : state === 'speaking'
        ? 'speaking'
        : state === 'thinking'
          ? 'thinking'
          : !isMutedState && customerSpeaking
            ? 'customer-speaking'
            : 'listening';

  const statusText = isConnecting
    ? 'Connecting…'
    : isRinging
      ? 'Ringing…'
      : isMutedState
        ? 'Muted'
        : state === 'speaking'
          ? 'Speaking'
          : state === 'thinking'
            ? 'Thinking…'
            : customerSpeaking
              ? 'Listening'
              : 'Connected';

  const dotClass =
    isConnecting || isRinging
      ? 'animate-pulse bg-brand-teal/80'
      : isMutedState
        ? 'bg-brand-muted/60'
        : state === 'speaking' || customerSpeaking
          ? 'animate-pulse bg-brand-teal'
          : 'bg-brand-teal';

  return (
    <section className="relative mx-auto flex min-h-[calc(100svh-5.5rem)] w-full max-w-md flex-col items-center justify-between px-5 pb-10 pt-8 text-center text-brand-text sm:py-12">
      <span
        data-voice-mode="livekit"
        className="absolute right-4 top-2 rounded-full border border-brand-border/70 bg-brand-surface/80 px-2.5 py-0.5 font-data text-[10px] text-brand-muted"
      >
        Mode: livekit
      </span>

      <header className="pt-4">
        <h1 className="font-display text-2xl font-medium tracking-tight text-brand-text sm:text-[1.85rem]">
          {clinicTitle}
        </h1>
        {isAgentReady && (
          <p className="mt-1 font-data text-xs tabular-nums text-brand-muted">
            {formatDuration(elapsed)}
          </p>
        )}
      </header>

      <div className="my-auto flex flex-col items-center py-6">
        <CloudOrb
          phase={orbPhase}
          muted={isMutedState}
          micLevelRef={micLevelRef}
          agentLevelRef={agentLevelRef}
        />

        <p
          role="status"
          aria-live="polite"
          className="mt-10 flex items-center justify-center gap-2 text-base font-normal text-brand-text/85"
        >
          <span className={`size-2 rounded-full ${dotClass}`} />
          {statusText}
        </p>

        {outputNotice && (
          <p className="mt-2 font-data text-[11px] text-brand-muted">{outputNotice}</p>
        )}

        {!audioOutput.canSwitchOutput && audioOutput.agentAudioMuted && (
          <p className="mt-2 text-xs text-brand-muted">Agent audio muted</p>
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 max-w-xs rounded-2xl border border-red-200 bg-red-50/90 px-4 py-2.5 text-xs text-red-800"
          >
            {error}
          </p>
        )}
      </div>

      <div className="flex w-full flex-col items-center gap-6 pb-2">
        <div className="flex items-center justify-center gap-7 sm:gap-9">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={isMutedState ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={isMutedState}
            title={isMutedState ? 'Unmute microphone' : 'Mute microphone'}
            className={`flex size-14 items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95 sm:size-16 ${
              isMutedState
                ? 'bg-brand-text text-brand-bg'
                : 'bg-[#ECE5D5] text-brand-text hover:bg-[#e3dac6]'
            }`}
          >
            {isMutedState ? (
              <MicOff className="size-5 sm:size-6" strokeWidth={1.75} />
            ) : (
              <Mic className="size-5 sm:size-6" strokeWidth={1.75} />
            )}
          </button>

          <button
            type="button"
            onClick={endCall}
            aria-label="End call"
            title="End call"
            className="flex size-16 items-center justify-center rounded-full bg-[#B5422D] text-white shadow-md transition-transform hover:scale-105 hover:bg-[#9f3825] active:scale-95 sm:size-[68px]"
          >
            <PhoneOff className="size-6" strokeWidth={1.9} />
          </button>

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

        <div className="w-full">
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="mx-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-brand-muted transition-colors hover:text-brand-text"
          >
            {showTranscript ? 'Hide transcript' : 'Live transcript'}
            {agentTranscriptions.length > 0 && ` (${agentTranscriptions.length})`}
            {showTranscript ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>

          {showTranscript && (
            <div className="mt-2 max-h-44 space-y-2 overflow-y-auto rounded-2xl border border-brand-border/80 bg-brand-surface/85 p-3 text-left">
              {agentTranscriptions.length === 0 ? (
                <p className="py-3 text-center text-xs text-brand-muted">
                  Agent responses will appear here as it speaks.
                </p>
              ) : (
                agentTranscriptions.map((item, idx) => (
                  <p
                    key={item.id ?? idx}
                    dir="auto"
                    className="rounded-xl bg-brand-bg/70 px-3 py-2 text-xs leading-relaxed text-brand-text"
                  >
                    {item.text}
                  </p>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
