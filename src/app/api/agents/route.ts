import { NextResponse } from "next/server";

import { apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createAgentSchema } from "@/lib/validations/agent";

export async function GET() {
  try {
    const user = await requireApiUser();

    const { data, error } = await supabaseAdmin
      .from("agents")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ agents: data });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser();
    const body = await req.json();
    const input = createAgentSchema.parse(body);

    const { data, error } = await supabaseAdmin
      .from("agents")
      .insert({
        user_id: user.id,
        ...input,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ agent: data }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err);
  }
}
