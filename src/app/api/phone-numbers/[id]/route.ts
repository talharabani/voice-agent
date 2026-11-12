import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";

const updateNumberSchema = z.object({
  agent_id: z.string().uuid().nullable(),
});

async function assertOwned(userId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("phone_numbers")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new ApiError("Number not found", 404);
}

/** PATCH /api/phone-numbers/[id] — reassign the number to another agent. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    await assertOwned(user.id, id);

    let input;
    try {
      input = updateNumberSchema.parse(await req.json());
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
      .update({ agent_id: input.agent_id })
      .eq("id", id)
      .select("*, agents(name)")
      .single();

    if (error) throw error;
    return NextResponse.json({ number: data });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/** DELETE /api/phone-numbers/[id] — disconnect a number. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    await assertOwned(user.id, id);

    const { error } = await supabaseAdmin.from("phone_numbers").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
