import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendAppointmentConfirmation } from "@/lib/whatsapp";

const updateAppointmentSchema = z.object({
  status: z.enum(["requested", "confirmed", "completed", "cancelled"]).optional(),
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  service: z.string().trim().max(200).nullable().optional(),
  customer_phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/).optional(),
  whatsapp_consent: z.boolean().optional(),
  notify: z.boolean().optional(),
  doctor_id: z.string().uuid().optional(),
});

async function assertOwned(userId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("appointments")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new ApiError("Appointment not found", 404);
  }
  return data;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const appointment = await assertOwned(user.id, id);
    let transcript: unknown = [];
    if (appointment.conversation_id) {
      const { data, error } = await supabaseAdmin.from('conversations').select('transcript').eq('id', appointment.conversation_id).eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      transcript = data?.transcript ?? [];
    }
    return NextResponse.json({ appointment, transcript });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const existing = await assertOwned(user.id, id);

    let input;
    try {
      input = updateAppointmentSchema.parse(await req.json());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid payload";
      return NextResponse.json({ error: message }, { status: 422 });
    }

    const { notify, ...changes } = input;
    let doctorName: string | undefined;
    if (changes.status === 'confirmed' || changes.doctor_id) {
      const doctorId = changes.doctor_id ?? existing.doctor_id;
      if (!doctorId) throw new ApiError('Select the clinic doctor who will see the patient.', 422);
      const { data: doctor, error: doctorError } = await supabaseAdmin.from('doctors').select('id, name').eq('id', doctorId).eq('user_id', user.id).eq('is_active', true).maybeSingle();
      if (doctorError) throw doctorError;
      if (!doctor) throw new ApiError('The selected doctor is unavailable for this clinic.', 422);
      doctorName = doctor.name;
    }
    const finalStatus = changes.status ?? existing.status;
    if (finalStatus === 'confirmed' && !(changes.scheduled_at ?? existing.scheduled_at)) {
      throw new ApiError('Choose an exact appointment date and time before confirming.', 422);
    }
    if (changes.status === 'confirmed' && new Date(changes.scheduled_at ?? existing.scheduled_at!).getTime() <= Date.now()) {
      throw new ApiError('Choose a future appointment date and time.', 422);
    }
    if (['sending', 'accepted', 'sent', 'delivered', 'read', 'unknown'].includes(existing.whatsapp_status) &&
      (changes.scheduled_at !== undefined || changes.customer_phone !== undefined || changes.service !== undefined || changes.doctor_id !== undefined)) {
      throw new ApiError('This confirmation has already been submitted. Contact the patient before changing its details.', 409);
    }
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update({ ...changes, ...(doctorName ? { doctor_name: doctorName, doctor_id: changes.doctor_id ?? existing.doctor_id } : {}), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("*, agents(name)")
      .single();

    if (error) throw error;

    let notificationError: string | null = null;
    if (finalStatus === 'confirmed' && (changes.status === 'confirmed' || notify)) {
      try { await sendAppointmentConfirmation(id, user.id); }
      catch (err) {
        console.error('Appointment notification failed', err);
        notificationError = 'Appointment saved, but the WhatsApp result could not be recorded. Check its status before retrying.';
      }
    }
    const { data: refreshed } = await supabaseAdmin.from('appointments').select('*, agents(name)').eq('id', id).eq('user_id', user.id).single();
    return NextResponse.json({ appointment: refreshed ?? data, notificationError });
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
    await assertOwned(user.id, id);

    const { error } = await supabaseAdmin
      .from("appointments")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
