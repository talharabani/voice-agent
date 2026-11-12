import { NextResponse } from 'next/server';
import { apiErrorResponse, requireApiUser } from '@/lib/api-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { clinicSchema } from '@/lib/validations/clinic';
import { whatsappConfigured, whatsappSetup } from '@/lib/whatsapp';

export async function GET() {
  try {
    const user = await requireApiUser();
    const { data, error } = await supabaseAdmin.from('clinic_profiles').select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ clinic: data, whatsappConfigured: whatsappConfigured(), whatsappSetup: whatsappSetup() });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const user = await requireApiUser();
    const parsed = clinicSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid clinic details' }, { status: 422 });
    const { data, error } = await supabaseAdmin.from('clinic_profiles').upsert({ ...parsed.data, user_id: user.id, updated_at: new Date().toISOString() }).select().single();
    if (error) throw error;
    return NextResponse.json({ clinic: data });
  } catch (error) { return apiErrorResponse(error); }
}
