"use client";
import { useParams } from "next/navigation";
import { AudioCall } from "@/components/voice/audio-call";
export default function PublicCallPage() {
  const { token } = useParams<{ token: string }>();
  return <main className="min-h-screen bg-brand-bg px-3 py-5 text-brand-text sm:px-6 sm:py-10"><AudioCall token={token} /></main>;
}
