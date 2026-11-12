import { NextResponse } from 'next/server';
import { requireApiUser, apiErrorResponse, ApiError } from '@/lib/api-helpers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { prepareWhatsAppMessage } from '@/lib/whatsapp-message';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(); const { id } = await params;
    const [{ data: appointment, error }, { data: clinic, error: clinicError }] = await Promise.all([
      supabaseAdmin.from('appointments').select('*').eq('id', id).eq('user_id', user.id).maybeSingle(),
      supabaseAdmin.from('clinic_profiles').select('*').eq('user_id', user.id).maybeSingle(),
    ]);
    if (error || clinicError) throw error || clinicError;
    if (!appointment) throw new ApiError('Appointment not found', 404);
    if (!clinic) throw new ApiError('Complete your clinic profile in Settings first.', 422);
    try { return NextResponse.json(prepareWhatsAppMessage(appointment, clinic), { headers: { 'Cache-Control': 'no-store' } }); }
    catch (error) { throw new ApiError(error instanceof Error ? error.message : 'Could not prepare WhatsApp message', 422); }
  } catch (error) { return apiErrorResponse(error); }
}
