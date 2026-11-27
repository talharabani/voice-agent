import { NextResponse } from 'next/server';
import { apiErrorResponse, requireApiUser } from '@/lib/api-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { clinicSchema } from '@/lib/validations/clinic';
import { whatsappConfigured, whatsappSetup } from '@/lib/whatsapp';

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  const msg = String((error as { message?: string }).message ?? '');
  return code === '42703' || code === 'PGRST204' || /column .* does not exist|schema cache/i.test(msg);
}

export async function GET() {
  try {
    const user = await requireApiUser();
    const { data, error } = await supabaseAdmin
      .from('clinic_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({
      clinic: data,
      whatsappConfigured: whatsappConfigured(),
      whatsappSetup: whatsappSetup(),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireApiUser();
    const parsed = clinicSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid clinic details' },
        { status: 422 }
      );
    }

    const now = new Date().toISOString();
    const fullPayload = { ...parsed.data, user_id: user.id, updated_at: now };
    const { data, error } = await supabaseAdmin
      .from('clinic_profiles')
      .upsert(fullPayload)
      .select()
      .single();

    if (error && isMissingColumnError(error)) {
      // Graceful fallback if migration 008_multitenant_clinic_config.sql is not yet applied
      const { clinic_name, address, phone, opening_hours, timezone } = parsed.data;
      const fallback = await supabaseAdmin
        .from('clinic_profiles')
        .upsert({ clinic_name, address, phone, opening_hours, timezone, user_id: user.id, updated_at: now })
        .select()
        .single();
      if (fallback.error) throw fallback.error;
      return NextResponse.json({
        clinic: fallback.data,
        warning:
          'Basic clinic details were saved. Run supabase/008_multitenant_clinic_config.sql in Supabase to persist services, slot duration, booking rules, and staff notification settings.',
      });
    }

    if (error) throw error;
    return NextResponse.json({ clinic: data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
