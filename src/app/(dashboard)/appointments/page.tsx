"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar as CalendarIcon,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Filter,
  LayoutGrid,
  List,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppointmentHandoff } from "@/components/dashboard/appointment-handoff";
import { WhatsAppDraft } from "@/components/dashboard/whatsapp-draft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AppointmentRow, DoctorRow } from "@/types/database";

type Appointment = AppointmentRow & { agents: { name: string } | null };

const HOUR_START = 8; // 08 AM
const HOUR_END = 21; // 09 PM
const ROW_HEIGHT = 64; // px per hour
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const MINI_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const MESSAGE_LABELS: Record<string, string> = {
  not_sent: "Not sent",
  setup_required: "Action needed",
  sending: "Sending",
  accepted: "Accepted by WhatsApp",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
  unknown: "Check Meta",
};

function startOfWeekMonday(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatHourLabel(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(h12).padStart(2, "0")} ${suffix}`;
}

function formatTimeRange(start: Date, durationMins = 30): string {
  const end = new Date(start.getTime() + durationMins * 60_000);
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

function toDatetimeLocalValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function parseAppointmentDate(appt: Appointment): Date | null {
  if (appt.scheduled_at) {
    const parsed = new Date(appt.scheduled_at);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (appt.requested_time) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[\sT]+(\d{1,2}):(\d{2})/.exec(
      appt.requested_time.trim()
    );
    if (m) {
      const d = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5])
      );
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function getGmtOffsetLabel(): string {
  const offsetMins = -new Date().getTimezoneOffset();
  const sign = offsetMins >= 0 ? "+" : "-";
  const absH = Math.floor(Math.abs(offsetMins) / 60);
  const absM = Math.abs(offsetMins) % 60;
  return absM ? `GMT${sign}${absH}:${String(absM).padStart(2, "0")}` : `GMT${sign}${absH}`;
}

function doctorInitials(name: string): string {
  return (
    name
      .replace(/^dr\.?\s*/i, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "DR"
  );
}

function cardStyleForStatus(status: Appointment["status"], isSelected: boolean): string {
  if (isSelected) {
    return "border-[#4A6850] bg-[#5B7760] text-[#F8F4E9] shadow-md ring-2 ring-[#5B7760]/30";
  }
  switch (status) {
    case "confirmed":
      return "border-[#7E9B76]/70 bg-[#E6EFE2] text-brand-text hover:border-[#5B7760]";
    case "requested":
      return "border-[#C99B58]/70 bg-[#F7EEDB] text-brand-text hover:border-[#B5813A]";
    case "completed":
      return "border-[#6F968C]/60 bg-[#E4EFEA] text-brand-text hover:border-[#4F786E]";
    case "cancelled":
      return "border-brand-border bg-brand-bg/90 text-brand-muted line-through opacity-75";
  }
}

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // Calendar & view controls
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [miniMonth, setMiniMonth] = useState<Date>(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [doctorFilterId, setDoctorFilterId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [now, setNow] = useState<Date>(() => new Date());

  // Edit / confirm schedule state
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [slot, setSlot] = useState("");
  const [phone, setPhone] = useState("");
  const [service, setService] = useState("");
  const [consent, setConsent] = useState(false);
  const [doctorId, setDoctorId] = useState("");

  // Create new manual appointment dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState({
    customer_name: "",
    customer_phone: "",
    doctor_id: "",
    service: "",
    scheduled_at: "",
    patient_concern: "",
    status: "confirmed" as "requested" | "confirmed",
    whatsapp_consent: false,
  });

  const load = useCallback(async () => {
    try {
      const [res, doctorRes] = await Promise.all([
        fetch("/api/appointments"),
        fetch("/api/doctors"),
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load appointments");
      setAppointments(data.appointments ?? []);
      setError("");

      const doctorData = await doctorRes.json();
      if (doctorRes.ok) {
        setDoctors(doctorData.doctors ?? []);
      } else {
        setError(
          "Doctor directory is temporarily unavailable. Please try again before confirming appointments."
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load appointments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(clock);
    };
  }, [load]);

  const weekStart = useMemo(() => startOfWeekMonday(selectedDate), [selectedDate]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const filteredAppointments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return appointments.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (doctorFilterId !== "all") {
        const doc = doctors.find((d) => d.id === doctorFilterId);
        const matchesId = a.doctor_id === doctorFilterId;
        const matchesName =
          doc &&
          (a.doctor_name?.toLowerCase() === doc.name.toLowerCase() ||
            a.requested_doctor?.toLowerCase() === doc.name.toLowerCase());
        if (!matchesId && !matchesName) return false;
      }
      if (q) {
        const hay = [
          a.customer_name,
          a.customer_phone,
          a.service,
          a.doctor_name,
          a.requested_doctor,
          a.patient_concern,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [appointments, doctorFilterId, doctors, searchQuery, statusFilter]);

  const { weekEvents, unscheduledRequests, daysWithEvents } = useMemo(() => {
    const daySet = new Set<string>();
    const inWeek: Array<{ appt: Appointment; start: Date; dayIdx: number }> = [];
    const unscheduled: Appointment[] = [];

    for (const appt of filteredAppointments) {
      const dt = parseAppointmentDate(appt);
      if (!dt) {
        if (appt.status !== "cancelled") unscheduled.push(appt);
        continue;
      }
      daySet.add(`${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`);
      const dayIdx = weekDays.findIndex((d) => isSameDay(d, dt));
      if (dayIdx >= 0) {
        inWeek.push({ appt, start: dt, dayIdx });
      }
    }
    return { weekEvents: inWeek, unscheduledRequests: unscheduled, daysWithEvents: daySet };
  }, [filteredAppointments, weekDays]);

  const miniCalendarCells = useMemo(() => {
    const year = miniMonth.getFullYear();
    const month = miniMonth.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = first.getDay() === 0 ? 6 : first.getDay() - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ date: Date; inMonth: boolean }> = [];

    for (let i = startOffset - 1; i >= 0; i--) {
      cells.push({ date: new Date(year, month, -i), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ date: new Date(year, month, day), inMonth: true });
    }
    while (cells.length % 7 !== 0) {
      const nextDay = cells.length - startOffset - daysInMonth + 1;
      cells.push({ date: new Date(year, month + 1, nextDay), inMonth: false });
    }
    return cells;
  }, [miniMonth]);

  function openScheduleEditor(appointment: Appointment) {
    const dt = parseAppointmentDate(appointment);
    const matchedDocId =
      appointment.doctor_id ||
      doctors.find(
        (d) =>
          d.is_active &&
          (d.name.toLowerCase() === appointment.doctor_name?.toLowerCase() ||
            d.name.toLowerCase() === appointment.requested_doctor?.toLowerCase())
      )?.id ||
      "";
    setSelected(appointment);
    setDoctorId(matchedDocId);
    setSlot(dt ? toDatetimeLocalValue(dt) : "");
    setPhone(appointment.customer_phone ?? "");
    setService(appointment.service ?? "");
    setConsent(appointment.whatsapp_consent);
  }

  function openNewBooking(prefillDate?: Date) {
    const target = prefillDate ?? new Date(Date.now() + 60 * 60 * 1000);
    if (!prefillDate) target.setMinutes(0, 0, 0);
    const firstActiveDoc =
      doctorFilterId !== "all"
        ? doctorFilterId
        : doctors.find((d) => d.is_active)?.id ?? "";
    setNewForm({
      customer_name: "",
      customer_phone: "",
      doctor_id: firstActiveDoc,
      service: "",
      scheduled_at: toDatetimeLocalValue(target),
      patient_concern: "",
      status: "confirmed",
      whatsapp_consent: false,
    });
    setCreateOpen(true);
  }

  async function update(id: string, changes: object) {
    setBusy(id);
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update appointment");
      setAppointments((rows) =>
        rows.map((row) => (row.id === id ? data.appointment : row))
      );
      if (data.notificationError) toast.warning(data.notificationError);
      else if (data.appointment.whatsapp_error && data.appointment.status === "confirmed")
        toast.warning(data.appointment.whatsapp_error);
      else toast.success("Appointment schedule updated");
      setSelected(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update appointment");
    } finally {
      setBusy(null);
    }
  }

  async function createAppointment(e: React.FormEvent) {
    e.preventDefault();
    if (!newForm.scheduled_at) {
      toast.error("Please select an appointment date and time.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newForm,
          scheduled_at: new Date(newForm.scheduled_at).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create appointment");
      setAppointments((prev) => [data.appointment, ...prev]);
      const createdDate = parseAppointmentDate(data.appointment);
      if (createdDate) {
        setSelectedDate(createdDate);
        setMiniMonth(new Date(createdDate.getFullYear(), createdDate.getMonth(), 1));
      }
      if (data.notificationError) toast.warning(data.notificationError);
      else toast.success("Appointment scheduled");
      setCreateOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create appointment");
    } finally {
      setCreating(false);
    }
  }

  function downloadCsv() {
    if (!filteredAppointments.length) {
      toast.info("No appointments to export.");
      return;
    }
    const headers = [
      "Patient",
      "Phone",
      "Doctor",
      "Service",
      "Status",
      "Requested Time",
      "Confirmed Slot",
      "WhatsApp Status",
    ];
    const escape = (val: string | null | undefined) =>
      `"${String(val ?? "").replace(/"/g, '""')}"`;
    const rows = filteredAppointments.map((a) =>
      [
        a.customer_name,
        a.customer_phone,
        a.doctor_name || a.requested_doctor,
        a.service,
        a.status,
        a.requested_time,
        a.scheduled_at ? new Date(a.scheduled_at).toLocaleString() : "",
        a.whatsapp_status,
      ]
        .map(escape)
        .join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clinic-appointments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function goToToday() {
    const t = new Date();
    setSelectedDate(t);
    setMiniMonth(new Date(t.getFullYear(), t.getMonth(), 1));
  }

  function shiftWeek(deltaDays: number) {
    const next = addDays(selectedDate, deltaDays);
    setSelectedDate(next);
    setMiniMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  }

  const nowMinutesFromStart =
    (now.getHours() - HOUR_START) * 60 + now.getMinutes();
  const showNowLine =
    nowMinutesFromStart >= 0 &&
    nowMinutesFromStart <= (HOUR_END - HOUR_START + 1) * 60 &&
    weekDays.some((d) => isSameDay(d, now));
  const nowLineTopPx = (nowMinutesFromStart / 60) * ROW_HEIGHT;

  const activeDoctors = useMemo(
    () => doctors.filter((d) => d.is_active),
    [doctors]
  );

  const requestedCount = appointments.filter((a) => a.status === "requested").length;
  const confirmedCount = appointments.filter((a) => a.status === "confirmed").length;

  return (
    <div className="space-y-5 text-brand-text">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-brand-text sm:text-3xl">
            Appointments
          </h1>
          <p className="mt-0.5 text-sm text-brand-muted">
            Manage your clinic schedule, review AI call requests, and confirm patient slots.
          </p>
        </div>
        <Button
          onClick={() => openNewBooking()}
          className="h-10 rounded-full bg-brand-text px-5 text-brand-bg shadow-xs hover:bg-brand-text/90"
        >
          <Plus className="size-4" />
          New appointment
        </Button>
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-brand-surface px-3 py-1.5 text-xs">
            <Filter className="size-3.5 text-brand-muted" />
            <select
              aria-label="Filter appointments by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent font-medium text-brand-text outline-none"
            >
              <option value="all">All statuses ({appointments.length})</option>
              <option value="requested">Requested ({requestedCount})</option>
              <option value="confirmed">Confirmed ({confirmedCount})</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => setViewMode((v) => (v === "calendar" ? "list" : "calendar"))}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-brand-surface px-3.5 py-1.5 text-xs font-medium text-brand-text transition-colors hover:bg-brand-surface-raised"
          >
            {viewMode === "calendar" ? (
              <>
                <CalendarIcon className="size-3.5 text-brand-teal" />
                Weekly
              </>
            ) : (
              <>
                <List className="size-3.5 text-brand-teal" />
                List view
              </>
            )}
          </button>

          <button
            type="button"
            onClick={downloadCsv}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-brand-surface px-3.5 py-1.5 text-xs font-medium text-brand-text transition-colors hover:bg-brand-surface-raised"
          >
            <Download className="size-3.5 text-brand-muted" />
            Download Data
          </button>

          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh appointments"
            className="inline-flex size-8 items-center justify-center rounded-full border border-brand-border bg-brand-surface text-brand-muted transition-colors hover:bg-brand-surface-raised hover:text-brand-text"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-brand-muted" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search patient, doctor, service..."
              className="h-9 w-56 rounded-full border border-brand-border bg-brand-surface pl-8 pr-3 text-xs text-brand-text placeholder:text-brand-muted focus:border-brand-teal focus:outline-none sm:w-64"
            />
          </div>

          <div className="inline-flex items-center rounded-full border border-brand-border bg-brand-surface p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              aria-label="Calendar layout"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === "calendar"
                  ? "bg-brand-text text-brand-bg"
                  : "text-brand-muted hover:text-brand-text"
              }`}
            >
              <LayoutGrid className="size-3.5" />
              Calendar
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              aria-label="List layout"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === "list"
                  ? "bg-brand-text text-brand-bg"
                  : "text-brand-muted hover:text-brand-text"
              }`}
            >
              <List className="size-3.5" />
              List
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Main 2-Column Workspace */}
      <div className="grid items-start gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">
        {/* LEFT SIDEBAR: Mini Month Calendar + Doctor Appointment List */}
        <aside className="space-y-5">
          {/* Mini Calendar Card */}
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-brand-text">
                Appointment Calendar
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setMiniMonth(
                      new Date(miniMonth.getFullYear(), miniMonth.getMonth() - 1, 1)
                    )
                  }
                  aria-label="Previous month"
                  className="flex size-7 items-center justify-center rounded-full bg-brand-text text-brand-bg transition-opacity hover:opacity-85"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setMiniMonth(
                      new Date(miniMonth.getFullYear(), miniMonth.getMonth() + 1, 1)
                    )
                  }
                  aria-label="Next month"
                  className="flex size-7 items-center justify-center rounded-full border border-brand-border bg-brand-surface-raised text-brand-text hover:bg-brand-bg"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>

            <p className="mb-3 font-data text-[11px] font-medium uppercase tracking-wider text-brand-muted">
              {miniMonth.toLocaleString("en-US", { month: "long", year: "numeric" })}
            </p>

            <div className="grid grid-cols-7 gap-y-1 text-center text-[11px] font-medium text-brand-muted">
              {MINI_WEEKDAYS.map((day) => (
                <span key={day} className="py-1">
                  {day}
                </span>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-y-1 text-center text-xs">
              {miniCalendarCells.map(({ date, inMonth }) => {
                const isSelectedDay = isSameDay(date, selectedDate);
                const isTodayCell = isSameDay(date, now);
                const inSelectedWeek =
                  date >= weekStart && date <= addDays(weekStart, 6);
                const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                const hasAppt = daysWithEvents.has(key);

                return (
                  <button
                    key={date.toISOString()}
                    type="button"
                    onClick={() => {
                      setSelectedDate(date);
                      if (!inMonth) {
                        setMiniMonth(new Date(date.getFullYear(), date.getMonth(), 1));
                      }
                    }}
                    className={`relative mx-auto flex size-8 flex-col items-center justify-center rounded-full text-xs transition-colors ${
                      isSelectedDay
                        ? "bg-[#5B7760] font-semibold text-white shadow-xs"
                        : inSelectedWeek
                          ? "bg-brand-teal/18 font-medium text-brand-text"
                          : isTodayCell
                            ? "border border-brand-teal font-semibold text-brand-text"
                            : inMonth
                              ? "text-brand-text hover:bg-brand-bg"
                              : "text-brand-muted/45 hover:bg-brand-bg/50"
                    }`}
                  >
                    <span>{date.getDate()}</span>
                    {hasAppt && (
                      <span
                        className={`mt-0.5 size-1 rounded-full ${
                          isSelectedDay ? "bg-white" : "bg-[#5B7760]"
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Doctor Appointment List Card */}
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-brand-text">
                Doctor Appointment List
              </h2>
              <span className="font-data text-[10px] uppercase tracking-wider text-brand-muted">
                {activeDoctors.length} active
              </span>
            </div>

            {activeDoctors.length === 0 ? (
              <p className="py-4 text-center text-xs text-brand-muted">
                Add doctors in the Doctors section to filter schedules by specialist.
              </p>
            ) : (
              <div className="space-y-2.5">
                {activeDoctors.slice(0, 6).map((doc) => {
                  const isActiveFilter = doctorFilterId === doc.id;
                  const docCount = appointments.filter(
                    (a) =>
                      a.status !== "cancelled" &&
                      (a.doctor_id === doc.id ||
                        a.doctor_name?.toLowerCase() === doc.name.toLowerCase() ||
                        a.requested_doctor?.toLowerCase() === doc.name.toLowerCase())
                  ).length;

                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() =>
                        setDoctorFilterId((prev) => (prev === doc.id ? "all" : doc.id))
                      }
                      className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-all ${
                        isActiveFilter
                          ? "border-[#5B7760] bg-brand-teal/15"
                          : "border-transparent bg-brand-bg/70 hover:border-brand-border hover:bg-brand-surface-raised"
                      }`}
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-brand-border bg-brand-teal/20 font-display text-xs font-semibold text-brand-text">
                        {doc.photo_url ? (
                          <img
                            src={doc.photo_url}
                            alt={doc.name}
                            className="size-full object-cover"
                          />
                        ) : (
                          doctorInitials(doc.name)
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-brand-text">
                          {doc.name}
                        </p>
                        <p className="truncate text-[11px] text-[#5B7760]">
                          {doc.specialty}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="inline-flex items-center gap-1 font-data text-[10px] text-brand-muted">
                          <Clock className="size-3" />
                          {docCount}
                        </span>
                        <p className="mt-0.5 max-w-[74px] truncate font-data text-[10px] text-brand-muted">
                          {doc.availability || "Clinic hrs"}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <Button
              type="button"
              onClick={() => {
                setDoctorFilterId("all");
                setStatusFilter("all");
                setSearchQuery("");
              }}
              className="mt-4 h-10 w-full rounded-full bg-[#5B7760] text-xs font-medium text-white hover:bg-[#4c6651]"
            >
              {doctorFilterId === "all" ? "See All" : "Show All Doctors"}
            </Button>
          </div>
        </aside>

        {/* RIGHT WORKSPACE: Weekly Calendar Grid or List View */}
        <section className="min-w-0 rounded-2xl border border-brand-border bg-brand-surface">
          {/* Calendar Top Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border px-5 py-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-lg font-semibold text-brand-text">
                {weekStart.toLocaleString("en-US", { month: "long", year: "numeric" })}
              </h2>
              <button
                type="button"
                onClick={goToToday}
                className="rounded-full border border-brand-border bg-brand-surface-raised px-3 py-1 text-xs font-medium text-brand-text transition-colors hover:bg-brand-bg"
              >
                Today
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => shiftWeek(-7)}
                  aria-label="Previous week"
                  className="flex size-7 items-center justify-center rounded-full border border-brand-border bg-brand-surface-raised text-brand-text hover:bg-brand-bg"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => shiftWeek(7)}
                  aria-label="Next week"
                  className="flex size-7 items-center justify-center rounded-full border border-brand-border bg-brand-surface-raised text-brand-text hover:bg-brand-bg"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-brand-border bg-brand-bg/70 p-1">
              {(["all", "requested", "confirmed", "completed"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    statusFilter === st
                      ? "bg-brand-surface-raised text-brand-text shadow-xs"
                      : "text-brand-muted hover:text-brand-text"
                  }`}
                >
                  {st === "all" ? "All" : st}
                </button>
              ))}
            </div>
          </div>

          {/* Unscheduled Voice-Call Requests Banner (never hides requests without an exact slot) */}
          {unscheduledRequests.length > 0 && viewMode === "calendar" && (
            <div className="border-b border-brand-border bg-[#F7EEDB]/60 px-5 py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-data text-[10px] font-semibold uppercase tracking-widest text-amber-900">
                  Awaiting exact slot ({unscheduledRequests.length})
                </p>
                <span className="text-[11px] text-brand-muted">
                  Click any request to assign doctor &amp; slot
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {unscheduledRequests.slice(0, 8).map((appt) => (
                  <button
                    key={appt.id}
                    type="button"
                    onClick={() => openScheduleEditor(appt)}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#C99B58]/60 bg-brand-surface-raised px-3 py-1.5 text-left text-xs transition-colors hover:border-[#5B7760]"
                  >
                    <span className="size-1.5 rounded-full bg-amber-600" />
                    <span className="font-medium text-brand-text">
                      {appt.customer_name || "Caller"}
                    </span>
                    <span className="text-brand-muted">
                      · {appt.service || appt.requested_doctor || "Consultation"}
                    </span>
                    {appt.requested_time && (
                      <span className="font-data text-[10px] text-brand-muted">
                        ({appt.requested_time})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <p className="p-10 text-center text-sm text-brand-muted">
              Loading clinic schedule...
            </p>
          ) : viewMode === "calendar" ? (
            /* WEEKLY TIME-GRID SCHEDULE */
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                {/* Day Header Row */}
                <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-brand-border bg-brand-surface-raised/60">
                  <div className="flex items-center justify-center border-r border-brand-border px-2 py-3 font-data text-[10px] uppercase tracking-wider text-brand-muted">
                    {getGmtOffsetLabel()}
                  </div>
                  {weekDays.map((day, i) => {
                    const isTodayCol = isSameDay(day, now);
                    const isSelectedCol = isSameDay(day, selectedDate);
                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        onClick={() => setSelectedDate(day)}
                        className={`flex items-center justify-center gap-1.5 border-r border-brand-border/70 px-2 py-3 text-xs font-medium last:border-r-0 transition-colors ${
                          isTodayCol
                            ? "bg-brand-teal/15 text-[#3F5D45] font-semibold"
                            : isSelectedCol
                              ? "bg-brand-bg/80 text-brand-text"
                              : "text-brand-muted hover:bg-brand-bg/40"
                        }`}
                      >
                        <span className="font-data text-[11px]">{WEEKDAY_LABELS[i]}</span>
                        <span
                          className={`inline-flex size-6 items-center justify-center rounded-full text-xs ${
                            isTodayCol
                              ? "bg-[#5B7760] text-white"
                              : "text-brand-text"
                          }`}
                        >
                          {day.getDate()}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Hourly Grid Body */}
                <div className="relative grid grid-cols-[72px_repeat(7,minmax(0,1fr))]">
                  {/* Time Axis Column */}
                  <div className="border-r border-brand-border bg-brand-surface-raised/35">
                    {HOURS.map((hour) => (
                      <div
                        key={hour}
                        style={{ height: `${ROW_HEIGHT}px` }}
                        className="flex items-start justify-end border-b border-brand-border/50 pr-3 pt-1.5 font-data text-[10px] text-brand-muted last:border-b-0"
                      >
                        {formatHourLabel(hour)}
                      </div>
                    ))}
                  </div>

                  {/* 7 Day Columns */}
                  {weekDays.map((day, dayIdx) => {
                    const dayEvents = weekEvents.filter((e) => e.dayIdx === dayIdx);
                    const isTodayCol = isSameDay(day, now);

                    return (
                      <div
                        key={day.toISOString()}
                        className={`relative border-r border-brand-border/60 last:border-r-0 ${
                          isTodayCol ? "bg-brand-teal/[0.04]" : ""
                        }`}
                      >
                        {/* Clickable hour slots */}
                        {HOURS.map((hour) => {
                          const isBreakHour = hour === 13; // 1 PM subtle hatched break band like mockup
                          return (
                            <button
                              key={hour}
                              type="button"
                              aria-label={`Schedule appointment on ${day.toDateString()} at ${formatHourLabel(hour)}`}
                              onClick={() => {
                                const dt = new Date(
                                  day.getFullYear(),
                                  day.getMonth(),
                                  day.getDate(),
                                  hour,
                                  0,
                                  0
                                );
                                openNewBooking(dt);
                              }}
                              style={{ height: `${ROW_HEIGHT}px` }}
                              className={`block w-full border-b border-brand-border/50 text-left transition-colors last:border-b-0 hover:bg-brand-teal/[0.08] ${
                                isBreakHour ? "calendar-hatch" : ""
                              }`}
                            />
                          );
                        })}

                        {/* Positioned Appointment Cards */}
                        {dayEvents.map(({ appt, start }) => {
                          const minsFromTop =
                            (start.getHours() - HOUR_START) * 60 + start.getMinutes();
                          const clampedMins = Math.max(
                            0,
                            Math.min((HOUR_END - HOUR_START) * 60, minsFromTop)
                          );
                          const topPx = (clampedMins / 60) * ROW_HEIGHT + 2;
                          const heightPx = Math.max(54, ROW_HEIGHT - 4);
                          const isSelected = selected?.id === appt.id;

                          return (
                            <button
                              key={appt.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openScheduleEditor(appt);
                              }}
                              style={{ top: `${topPx}px`, minHeight: `${heightPx}px` }}
                              className={`absolute inset-x-1 z-10 flex flex-col justify-between overflow-hidden rounded-xl border px-2.5 py-1.5 text-left transition-all ${cardStyleForStatus(
                                appt.status,
                                isSelected
                              )}`}
                            >
                              <p className="truncate text-xs font-semibold leading-tight">
                                {appt.service || appt.customer_name || "Clinic Visit"}
                              </p>
                              <p
                                className={`truncate font-data text-[10px] ${
                                  isSelected ? "text-[#F8F4E9]/85" : "text-brand-muted"
                                }`}
                              >
                                {formatTimeRange(start)}
                              </p>
                              <p
                                className={`truncate text-[10px] ${
                                  isSelected ? "text-[#F8F4E9]/90" : "text-brand-muted"
                                }`}
                              >
                                {appt.customer_name || "Patient"}
                                {appt.doctor_name || appt.requested_doctor
                                  ? ` · ${appt.doctor_name || appt.requested_doctor}`
                                  : ""}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}

                  {/* Live Current-Time Dotted Sage Line */}
                  {showNowLine && (
                    <div
                      style={{ top: `${nowLineTopPx}px` }}
                      className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                    >
                      <span className="ml-1.5 rounded-full bg-[#5B7760] px-2 py-0.5 font-data text-[9px] font-semibold text-white shadow-xs">
                        {now.toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                        })}
                      </span>
                      <span className="size-2 rounded-full bg-[#5B7760]" />
                      <div className="flex-1 border-t border-dashed border-[#5B7760]/80" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* CLASSIC LIST VIEW */
            <div className="divide-y divide-brand-border p-5">
              {filteredAppointments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-brand-border p-12 text-center text-sm text-brand-muted">
                  No matching appointments found.
                </div>
              ) : (
                filteredAppointments.map((appointment) => (
                  <article
                    key={appointment.id}
                    className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-base font-semibold text-brand-text">
                          {appointment.customer_name || "Unknown caller"}
                        </h3>
                        <Badge
                          variant={
                            appointment.status === "cancelled"
                              ? "destructive"
                              : appointment.status === "confirmed"
                                ? "default"
                                : "secondary"
                          }
                        >
                          {appointment.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-brand-muted">
                        {appointment.service || "Clinic consultation"} ·{" "}
                        {appointment.doctor_name ||
                          appointment.requested_doctor ||
                          "Doctor to assign"}{" "}
                        · {appointment.customer_phone || "No phone"}
                      </p>
                      <p className="font-data text-[11px] text-brand-muted">
                        {appointment.scheduled_at
                          ? new Date(appointment.scheduled_at).toLocaleString()
                          : appointment.requested_time || "Awaiting slot confirmation"}{" "}
                        · WhatsApp: {MESSAGE_LABELS[appointment.whatsapp_status] || "Not sent"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <AppointmentHandoff id={appointment.id} />
                      {["requested", "confirmed"].includes(appointment.status) && (
                        <WhatsAppDraft id={appointment.id} />
                      )}
                      <Button
                        size="sm"
                        onClick={() => openScheduleEditor(appointment)}
                        className="rounded-full bg-[#5B7760] text-white hover:bg-[#4c6651]"
                      >
                        <CalendarCheck className="size-3.5" />
                        Edit schedule
                      </Button>
                    </div>
                  </article>
                ))
              )}
            </div>
          )}
        </section>
      </div>

      {/* EDIT SCHEDULE DIALOG (inspired by mockup's floating Edit Schedule card) */}
      {selected && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setSelected(null);
          }}
        >
          <DialogContent
            showCloseButton={!busy}
            className="max-h-[90dvh] overflow-y-auto rounded-2xl border-brand-border bg-brand-surface text-brand-text sm:max-w-lg"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="font-display text-xl font-semibold">
                  Edit Schedule
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-xs">
                  {selected.customer_name || "Patient"} ·{" "}
                  {selected.agents?.name ?? "Voice receptionist"}
                </DialogDescription>
              </div>
              <Badge
                variant={
                  selected.status === "cancelled"
                    ? "destructive"
                    : selected.status === "confirmed"
                      ? "default"
                      : "secondary"
                }
              >
                {selected.status}
              </Badge>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (slot) {
                  void update(selected.id, {
                    status: "confirmed",
                    doctor_id: doctorId,
                    scheduled_at: new Date(slot).toISOString(),
                    customer_phone: phone,
                    service: service || null,
                    whatsapp_consent: consent,
                  });
                }
              }}
              className="mt-2 flex flex-col gap-4"
            >
              {selected.patient_concern && (
                <div className="rounded-xl border border-brand-border bg-brand-bg/70 px-3.5 py-2.5 text-xs">
                  <p className="font-data text-[10px] uppercase tracking-wider text-brand-muted">
                    Patient concern
                  </p>
                  <p dir="auto" className="mt-1 text-brand-text">
                    {selected.patient_concern}
                  </p>
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="edit-service">Service / appointment title</Label>
                <Input
                  id="edit-service"
                  value={service}
                  maxLength={200}
                  placeholder="Dental Check-up, Dermatology Consultation..."
                  onChange={(e) => setService(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-doctor">Assigned doctor</Label>
                <select
                  id="edit-doctor"
                  required
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  className="h-10 rounded-md border border-brand-border bg-brand-bg px-3 text-sm text-brand-text"
                >
                  <option value="">Choose an active clinic doctor</option>
                  {activeDoctors.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.name} — {doc.specialty}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-slot">Date &amp; time</Label>
                <Input
                  id="edit-slot"
                  type="datetime-local"
                  required
                  value={slot}
                  onChange={(e) => setSlot(e.target.value)}
                />
                {selected.requested_time && (
                  <p className="text-[11px] text-brand-muted">
                    Caller requested: {selected.requested_time}
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-phone">Patient WhatsApp number</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  required
                  pattern="\+[1-9][0-9]{7,14}"
                  placeholder="+923001234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <label className="flex items-start gap-2.5 text-xs text-brand-muted">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Patient agreed to receive WhatsApp confirmation (
                {MESSAGE_LABELS[selected.whatsapp_status] || "Not sent"})
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-brand-border pt-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <AppointmentHandoff id={selected.id} />
                  {["requested", "confirmed"].includes(selected.status) && (
                    <WhatsAppDraft id={selected.id} />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => setSelected(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!!busy}
                    className="rounded-full bg-[#5B7760] px-5 text-white hover:bg-[#4c6651]"
                  >
                    {busy === selected.id ? "Saving..." : "Save & Confirm"}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-bg/70 px-3 py-2 text-xs">
                <span className="flex items-center gap-1.5 text-brand-muted">
                  <MessageCircle className="size-3.5 text-[#5B7760]" />
                  Quick actions
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {selected.status === "confirmed" && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void update(selected.id, { status: "completed" })}
                      >
                        Mark completed
                      </Button>
                      {["not_sent", "failed", "setup_required"].includes(
                        selected.whatsapp_status
                      ) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => void update(selected.id, { notify: true })}
                        >
                          Send WhatsApp
                        </Button>
                      )}
                    </>
                  )}
                  {["requested", "confirmed"].includes(selected.status) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-red-700 hover:bg-red-50 hover:text-red-800"
                      disabled={!!busy}
                      onClick={() => void update(selected.id, { status: "cancelled" })}
                    >
                      <X className="size-3.5" />
                      Cancel booking
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* NEW APPOINTMENT DIALOG */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!creating) setCreateOpen(open);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl border-brand-border bg-brand-surface text-brand-text sm:max-w-lg">
          <DialogTitle className="font-display text-xl font-semibold">
            New appointment
          </DialogTitle>
          <DialogDescription>
            Schedule a patient directly on your clinic&apos;s calendar.
          </DialogDescription>
          <form onSubmit={createAppointment} className="mt-2 flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="new-patient-name">Patient name</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-brand-muted" />
                  <Input
                    id="new-patient-name"
                    required
                    placeholder="Ayesha Khan"
                    className="pl-8"
                    value={newForm.customer_name}
                    onChange={(e) =>
                      setNewForm((p) => ({ ...p, customer_name: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="new-patient-phone">WhatsApp / Phone</Label>
                <Input
                  id="new-patient-phone"
                  type="tel"
                  required
                  pattern="\+[1-9][0-9]{7,14}"
                  placeholder="+923001234567"
                  value={newForm.customer_phone}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, customer_phone: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="new-service">Service</Label>
                <Input
                  id="new-service"
                  required
                  placeholder="Dental Check-up"
                  value={newForm.service}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, service: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="new-doctor">Doctor</Label>
                <select
                  id="new-doctor"
                  required
                  value={newForm.doctor_id}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, doctor_id: e.target.value }))
                  }
                  className="h-10 rounded-md border border-brand-border bg-brand-bg px-3 text-sm text-brand-text"
                >
                  <option value="">Choose an active doctor</option>
                  {activeDoctors.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.name} — {doc.specialty}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="new-slot">Appointment date &amp; time</Label>
              <Input
                id="new-slot"
                type="datetime-local"
                required
                value={newForm.scheduled_at}
                onChange={(e) =>
                  setNewForm((p) => ({ ...p, scheduled_at: e.target.value }))
                }
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="new-concern">Patient notes / concern (optional)</Label>
              <Input
                id="new-concern"
                placeholder="Routine check-up or sensitivity"
                value={newForm.patient_concern}
                onChange={(e) =>
                  setNewForm((p) => ({ ...p, patient_concern: e.target.value }))
                }
              />
            </div>

            <label className="flex items-start gap-2.5 text-xs text-brand-muted">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={newForm.whatsapp_consent}
                onChange={(e) =>
                  setNewForm((p) => ({ ...p, whatsapp_consent: e.target.checked }))
                }
              />
              Send WhatsApp confirmation if patient consented
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating}
                className="rounded-full bg-[#5B7760] px-5 text-white hover:bg-[#4c6651]"
              >
                {creating ? "Scheduling..." : "Save appointment"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
