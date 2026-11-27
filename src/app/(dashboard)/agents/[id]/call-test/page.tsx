import { connection } from "next/server";
import { AudioCall } from "@/components/voice/audio-call";
import { getServerVoiceMode } from "@/lib/voice/mode";

export default async function CallTestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const voiceMode = getServerVoiceMode();

  return <AudioCall agentId={id} mode={voiceMode} />;
}
