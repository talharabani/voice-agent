import { connection } from "next/server";
import { AudioCall } from "@/components/voice/audio-call";
import { getServerVoiceMode } from "@/lib/voice/mode";

export default async function PublicCallPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
  const { token } = await params;
  const voiceMode = getServerVoiceMode();

  return (
    <main className="min-h-screen bg-brand-bg px-3 py-5 text-brand-text sm:px-6 sm:py-10">
      <AudioCall token={token} mode={voiceMode} />
    </main>
  );
}
