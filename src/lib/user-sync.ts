import "server-only";
import { currentUser } from "@clerk/nextjs/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { UserRow } from "@/types/database";

/**
 * Resolves a Clerk user to their Supabase `users` row, creating the row
 * on the fly when it doesn't exist yet.
 *
 * The Clerk webhook normally provisions this row, but it can't reach a
 * local dev server (no public URL) and can lag in production — so auth
 * must never depend on it having fired.
 */
function describeError(err: unknown): string {
  if (!err) return "unknown error";
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  const e = err as { message?: string; code?: string; details?: string; hint?: string };
  return (
    [e.code, e.message, e.details, e.hint].filter(Boolean).join(" | ") ||
    JSON.stringify(err)
  );
}

export async function ensureUserRow(clerkId: string): Promise<UserRow | null> {
  const { data: existing, error: selectError } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("clerk_id", clerkId)
    .single();

  if (existing) return existing;

  // PGRST116 = no rows found (expected for a first visit); anything else
  // means Supabase itself is misbehaving (unreachable, paused, bad key).
  if (selectError && selectError.code !== "PGRST116") {
    console.error(
      "Supabase users select failed:",
      describeError(selectError),
      "- Is the Supabase project active and NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY correct?"
    );
    return null;
  }

  // No row yet — build one from the live Clerk profile.
  const clerkUser = await currentUser();
  if (!clerkUser || clerkUser.id !== clerkId) return null;

  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) return null;

  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;

  const { data: inserted, error } = await supabaseAdmin
    .from("users")
    .insert({ clerk_id: clerkId, email, name })
    .select()
    .single();

  if (!error && inserted) return inserted;

  // Insert may have raced with the webhook — try reading once more.
  const { data: again } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("clerk_id", clerkId)
    .single();

  if (!again) {
    console.error(
      "Failed to provision user row for Clerk user",
      clerkId,
      "- insert error:",
      describeError(error)
    );
  }
  return again ?? null;
}
