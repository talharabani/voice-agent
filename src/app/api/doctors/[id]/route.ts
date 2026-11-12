import { NextResponse } from 'next/server';
import { apiErrorResponse, requireApiUser, ApiError } from '@/lib/api-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { doctorSchema } from '@/lib/validations/doctor';
import { z } from 'zod';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError('Invalid doctor ID', 422);
    const parsed = doctorSchema.partial().safeParse(await request.json());
    if (!parsed.success) throw new ApiError(parsed.error.issues[0].message, 422);
    const { data, error } = await supabaseAdmin.from('doctors').update({ ...parsed.data, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id).select().maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError('Doctor not found', 404);
    return NextResponse.json({ doctor: data });
  } catch (error) { return apiErrorResponse(error); }
}
