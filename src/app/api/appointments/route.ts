import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, apiErrorResponse, requireApiUser } from "@/lib/api-helpers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadClinicDirectory } from "@/lib/clinic-directory";
import { notifyClinicStaff, sendAppointmentConfirmation } from "@/lib/whatsapp";

const createAppointmentSchema = z.object({
  customer_name: z.string().trim().min(1, "Patient name is required").max(160),
  customer_phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "Use an international number, for example +923001234567"),
  doctor_id: z.string().uuid("Select an active clinic doctor"),
  service: z.string().trim().min(1, "Service is required").max(200),
  scheduled_at: z.string().datetime({ offset: true }),
  patient_concern: z.string().trim().max(500).optional().default(""),
  status: z.enum(["requested", "confirmed"]).optional().default("confirmed"),
  whatsapp_consent: z.boolean().optional().default(false),
});

/**
 * GET /api/appointments — the user's appointments, newest first.
 */
export async function GET() {
  try {
    const user = await requireApiUser();

    const { data, error } = await supabaseAdmin
      .from("appointments")
      .select("*, agents(name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    return NextResponse.json({ appointments: data });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/**
 * POST /api/appointments — manually create a clinic appointment from the dashboard calendar.
 */
export async function POST(req: Request) {
  try {
    const user = await requireApiUser();
    const parsed = createAppointmentSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0]?.message ?? "Invalid appointment details", 422);
    }
    const input = parsed.data;

    // Verify selected doctor belongs to this clinic and is active
    const [doctorRes, agentRes, directory] = await Promise.all([
      supabaseAdmin
        .from("doctors")
        .select("id, name")
        .eq("id", input.doctor_id)
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle(),
      supabaseAdmin
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .order("is_active", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      loadClinicDirectory(user.id),
    ]);

    if (doctorRes.error) throw doctorRes.error;
    if (!doctorRes.data) {
      throw new ApiError("Selected doctor was not found in your clinic directory.", 422);
    }
    if (agentRes.error) throw agentRes.error;
    if (!agentRes.data) {
      throw new ApiError("Create at least one clinic agent first before adding appointments.", 422);
    }

    const scheduledDate = new Date(input.scheduled_at);
    const requestedTime = `${scheduledDate.getFullYear()}-${String(scheduledDate.getMonth() + 1).padStart(2, "0")}-${String(scheduledDate.getDate()).padStart(2, "0")} ${String(scheduledDate.getHours()).padStart(2, "0")}:${String(scheduledDate.getMinutes()).padStart(2, "0")}`;

    const { data: created, error: insertError } = await supabaseAdmin
      .from("appointments")
      .insert({
        user_id: user.id,
        agent_id: agentRes.data.id,
        doctor_id: doctorRes.data.id,
        doctor_name: doctorRes.data.name,
        requested_doctor: doctorRes.data.name,
        customer_name: input.customer_name,
        customer_phone: input.customer_phone,
        service: input.service,
        patient_concern: input.patient_concern || input.service,
        scheduled_at: scheduledDate.toISOString(),
        requested_time: requestedTime,
        status: input.status,
        whatsapp_consent: input.whatsapp_consent,
        call_summary: `Manually scheduled in dashboard\nService: ${input.service}\nDoctor: ${doctorRes.data.name}`,
      })
      .select("*")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        throw new ApiError("That doctor already has an active appointment at that exact time.", 409);
      }
      throw insertError;
    }
    if (!created) throw new Error("Failed to save appointment");

    let notificationError: string | null = null;
    if (input.status === "confirmed" && input.whatsapp_consent) {
      try {
        await sendAppointmentConfirmation(created.id, user.id);
      } catch {
        notificationError = "Appointment saved, but WhatsApp confirmation could not be sent.";
      }
    }

    await notifyClinicStaff({
      clinic: directory.clinic,
      appointment: created,
    });

    const { data: refreshed } = await supabaseAdmin
      .from("appointments")
      .select("*, agents(name)")
      .eq("id", created.id)
      .eq("user_id", user.id)
      .single();

    return NextResponse.json(
      { appointment: refreshed ?? created, notificationError },
      { status: 201 }
    );
  } catch (err) {
    return apiErrorResponse(err);
  }
}
