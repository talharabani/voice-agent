import "server-only";
import { createHash, timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison. Hashes both sides first so inputs
 * of different lengths can be compared without leaking length info.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}
