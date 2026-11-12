import { NextResponse } from "next/server";

import { ApiError, apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { updateAgentSchema } from "@/lib/validations/agent";

async function getOwnedAgentOr404(userId: string, agentId: string) {
  const { data, error } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new ApiError("Agent not found", 404);
  }

  return data;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const agent = await getOwnedAgentOr404(user.id, id);
    return NextResponse.json({ agent });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    await getOwnedAgentOr404(user.id, id);

    const body = await req.json();
    const input = updateAgentSchema.parse(body);

    const { data, error } = await supabaseAdmin
      .from("agents")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ agent: data });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
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
    await getOwnedAgentOr404(user.id, id);

    const { error } = await supabaseAdmin.from("agents").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
