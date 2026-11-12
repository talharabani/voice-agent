import "server-only";

/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Good enough for a single-process dev/MVP deployment. For production
 * (multiple instances) move this to Redis — the call sites won't change.
 */

type WindowEntry = { timestamps: number[] };

const buckets = new Map<string, WindowEntry>();

// Periodically drop stale buckets so the map doesn't grow forever.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of buckets) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
    if (entry.timestamps.length === 0) buckets.delete(key);
  }
}

/**
 * Returns true when the caller identified by `key` is within
 * `limit` requests per `windowMs`, false when they should be rejected.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  cleanup(windowMs);

  const entry = buckets.get(key) ?? { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  if (entry.timestamps.length >= limit) {
    const oldest = entry.timestamps[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    buckets.set(key, entry);
    return { allowed: false, retryAfterSeconds };
  }

  entry.timestamps.push(now);
  buckets.set(key, entry);
  return { allowed: true, retryAfterSeconds: 0 };
}
