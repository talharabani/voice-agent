import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";

const createNumberSchema = z.object({
  phone_number: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, "Use E.164 format, e.g. +14155550123"),
  agent_id: z.string().uuid().nullable().optional(),
  provider: z.string().trim().max(40).default("twilio"),
});

/** GET /api/phone-numbers — the user's connected numbers. */
export async function GET() {
  try {
    const user = await requireApiUser();

    const { data, error } = await supabaseAdmin
      .from("phone_numbers")
      .select("*, agents(name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ numbers: data });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/** POST /api/phone-numbers — register a number and assign it to an agent. */
export async function POST(req: Request) {
  try {
    const user = await requireApiUser();

    let input;
    try {
      input = createNumberSchema.parse(await req.json());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid payload";
      return NextResponse.json({ error: message }, { status: 422 });
    }

    if (input.agent_id) {
      const { data: agent } = await supabaseAdmin
        .from("agents")
        .select("id")
        .eq("id", input.agent_id)
        .eq("user_id", user.id)
        .single();
      if (!agent) throw new ApiError("Agent not found", 404);
    }

    const { data, error } = await supabaseAdmin
      .from("phone_numbers")
      .insert({
        user_id: user.id,
        phone_number: input.phone_number,
        agent_id: input.agent_id ?? null,
        provider: input.provider,
      })
      .select("*, agents(name)")
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new ApiError("This number is already registered", 409);
      }
      throw error;
    }

    return NextResponse.json({ number: data }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
