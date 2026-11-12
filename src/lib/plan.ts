import "server-only";

/**
 * Plan limits — calls included per calendar month.
 * Mirrors the pricing model in the VOXA plan doc; adjust as plans launch.
 */
export const PLAN_CALL_LIMITS: Record<string, number> = {
  free: 50,
  starter: 500,
  pro: 5000,
};

export function callLimitForPlan(plan: string): number {
  return PLAN_CALL_LIMITS[plan] ?? PLAN_CALL_LIMITS.free;
}

/** ISO timestamp for the start of the current calendar month (UTC). */
export function monthStartISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
