"use client";
import { useParams } from "next/navigation";
import { AudioCall } from "@/components/voice/audio-call";
export default function CallTestPage() {
  const { id } = useParams<{ id: string }>();
  return <AudioCall agentId={id} />;
}
