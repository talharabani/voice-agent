import "server-only";
import { createHmac } from "crypto";

import type { AgentRow, KnowledgeDocRow } from "@/types/database";
import type { CallTurn } from "@/lib/voice/respond";

/* ---------------- Twilio request signature validation ---------------- */

/**
 * Validates Twilio's X-Twilio-Signature header:
 * Base64(HMAC-SHA1(authToken, url + sortedKey1 + value1 + sortedKey2 + ...))
 * `url` must be the exact public URL Twilio called (set TWILIO_WEBHOOK_BASE
 * to your public base, e.g. the ngrok/cloudflared URL).
 */
export function validateTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn(
      "TWILIO_AUTH_TOKEN is not set — Twilio webhook signature NOT verified. Set it before going live."
    );
    return true; // dev convenience; production must set the token
  }
  if (!signature) return false;

  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");

  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");

  // Length-safe comparison
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/* --------------------------- TwiML helpers --------------------------- */

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const VOICE_MAP: Record<string, string> = {
  nova: "Polly.Joanna",
  echo: "Polly.Matthew",
  alloy: "Polly.Amy",
  shimmer: "Polly.Salli",
};

export function twilioVoiceFor(agentVoice: string): string {
  return VOICE_MAP[agentVoice] ?? "Polly.Joanna";
}

export function twimlResponse(xmlInner: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${xmlInner}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

/* ------------------------ In-memory call state ------------------------ */
/* Dev/MVP: one server process. For production move to Redis — the shape
   of the store is deliberately simple so the swap is mechanical.        */

export interface CallState {
  agent: AgentRow;
  knowledge: KnowledgeDocRow[];
  history: CallTurn[];
  startedAt: number;
  callerPhone: string | null;
}

const STATE_TTL_MS = 60 * 60 * 1000;

const callStates = new Map<string, { state: CallState; touchedAt: number }>();

function sweep() {
  const now = Date.now();
  for (const [sid, entry] of callStates) {
    if (now - entry.touchedAt > STATE_TTL_MS) callStates.delete(sid);
  }
}

export function getCallState(callSid: string): CallState | null {
  sweep();
  const entry = callStates.get(callSid);
  if (!entry) return null;
  entry.touchedAt = Date.now();
  return entry.state;
}

export function setCallState(callSid: string, state: CallState) {
  callStates.set(callSid, { state, touchedAt: Date.now() });
}

export function deleteCallState(callSid: string) {
  callStates.delete(callSid);
}
