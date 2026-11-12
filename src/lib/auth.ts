import "server-only";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { ensureUserRow } from "@/lib/user-sync";
import type { UserRow } from "@/types/database";

/**
 * Resolves the currently signed-in Clerk user to the matching row
 * in the Supabase `users` table, creating the row on first visit
 * (the Clerk webhook can't reach a local dev server, and may lag in
 * production). Redirects to /sign-in only when truly unauthenticated.
 */
export async function getCurrentUser(): Promise<UserRow> {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    redirect("/sign-in");
  }

  const user = await ensureUserRow(clerkId);

  if (!user) {
    // Signed in to Clerk but we couldn't create/read the Supabase row.
    // Don't bounce to /sign-in (that loops for a signed-in user).
    throw new Error(
      "Could not load your account. Check that Supabase is reachable and the users table exists."
    );
  }

  return user;
}

export async function getCurrentUserId(): Promise<string> {
  const user = await getCurrentUser();
  return user.id;
}
