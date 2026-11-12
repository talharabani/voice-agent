import "server-only";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { ensureUserRow } from "@/lib/user-sync";
import type { UserRow } from "@/types/database";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolves the authenticated request to a Supabase user row.
 * Throws ApiError(401) if not authenticated, ApiError(404) if the
 * Clerk user has no matching Supabase row yet (webhook lag).
 */
export async function requireApiUser(): Promise<UserRow> {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    throw new ApiError("Unauthorized", 401);
  }

  const user = await ensureUserRow(clerkId);

  if (!user) {
    throw new ApiError("User account could not be provisioned", 500);
  }

  return user;
}

export function apiErrorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("Unhandled API error", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
