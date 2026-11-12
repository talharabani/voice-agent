import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";

const updateLeadSchema = z.object({
  status: z.enum(["new", "contacted", "qualified", "won", "lost"]).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

async function getOwnedLeadOr404(userId: string, leadId: string) {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new ApiError("Lead not found", 404);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    await getOwnedLeadOr404(user.id, id);

    let input;
    try {
      input = updateLeadSchema.parse(await req.json());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid payload";
      return NextResponse.json({ error: message }, { status: 422 });
    }

    const { data, error } = await supabaseAdmin
      .from("leads")
      .update(input)
      .eq("id", id)
      .select("*, agents(name)")
      .single();

    if (error) throw error;

    return NextResponse.json({ lead: data });
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
    await getOwnedLeadOr404(user.id, id);

    const { error } = await supabaseAdmin.from("leads").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
