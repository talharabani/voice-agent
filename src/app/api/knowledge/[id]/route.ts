import { NextResponse } from "next/server";

import { ApiError, apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * DELETE /api/knowledge/[id] — remove a knowledge source the user owns
 * (ownership established through the parent agent).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser();
    const { id } = await params;

    const { data: doc, error: findError } = await supabaseAdmin
      .from("knowledge_docs")
      .select("id, agents!inner(user_id)")
      .eq("id", id)
      .eq("agents.user_id", user.id)
      .single();

    if (findError || !doc) {
      throw new ApiError("Knowledge source not found", 404);
    }

    const { error } = await supabaseAdmin
      .from("knowledge_docs")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
