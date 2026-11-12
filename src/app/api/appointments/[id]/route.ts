import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";

const updateAppointmentSchema = z.object({
  status: z.enum(["requested", "confirmed", "completed", "cancelled"]).optional(),
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  service: z.string().trim().max(200).nullable().optional(),
});

async function assertOwned(userId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("appointments")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new ApiError("Appointment not found", 404);
  }
}

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
      input = updateAppointmentSchema.parse(await req.json());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid payload";
      return NextResponse.json({ error: message }, { status: 422 });
    }

    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*, agents(name)")
      .single();

    if (error) throw error;

    return NextResponse.json({ appointment: data });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    await assertOwned(user.id, id);

    const { error } = await supabaseAdmin
      .from("appointments")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
