import { NextResponse } from 'next/server';
import { apiErrorResponse, requireApiUser, ApiError } from '@/lib/api-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { doctorSchema } from '@/lib/validations/doctor';

export async function GET() {
  try {
    const user = await requireApiUser();
    const { data, error } = await supabaseAdmin.from('doctors').select('*').eq('user_id', user.id).order('name');
    if (error) throw error;
    return NextResponse.json({ doctors: data });
  } catch (error) { return apiErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const parsed = doctorSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(parsed.error.issues[0].message, 422);
    const { count, error: countError } = await supabaseAdmin.from('doctors').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
    if (countError) throw countError;
    if ((count ?? 0) >= 100) throw new ApiError('This clinic has reached its 100-doctor directory limit.', 422);
    const { data, error } = await supabaseAdmin.from('doctors').insert({ ...parsed.data, user_id: user.id }).select().single();
    if (error) throw error;
    return NextResponse.json({ doctor: data }, { status: 201 });
  } catch (error) { return apiErrorResponse(error); }
}
