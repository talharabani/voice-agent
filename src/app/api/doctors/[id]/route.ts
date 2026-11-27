import { NextResponse } from 'next/server';
import { apiErrorResponse, requireApiUser, ApiError } from '@/lib/api-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { doctorSchema } from '@/lib/validations/doctor';
import { z } from 'zod';

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  const msg = String((error as { message?: string }).message ?? '');
  return code === '42703' || code === 'PGRST204' || /column .* does not exist|schema cache/i.test(msg);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError('Invalid doctor ID', 422);
    const parsed = doctorSchema.partial().safeParse(await request.json());
    if (!parsed.success) throw new ApiError(parsed.error.issues[0].message, 422);

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('doctors')
      .update({ ...parsed.data, updated_at: now })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .maybeSingle();

    if (error && isMissingColumnError(error)) {
      const { consultation_fee: _fee, slot_duration_minutes: _dur, ...core } = parsed.data;
      const fallback = await supabaseAdmin
        .from('doctors')
        .update({ ...core, updated_at: now })
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      if (!fallback.data) throw new ApiError('Doctor not found', 404);
      return NextResponse.json({ doctor: fallback.data });
    }

    if (error) throw error;
    if (!data) throw new ApiError('Doctor not found', 404);
    return NextResponse.json({ doctor: data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError('Invalid doctor ID', 422);

    const { data, error } = await supabaseAdmin
      .from('doctors')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new ApiError('Doctor not found', 404);
    return NextResponse.json({ deleted: true, id: data.id });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
