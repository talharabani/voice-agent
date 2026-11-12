"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

type Status = "requested" | "confirmed" | "completed" | "cancelled";

interface Appointment {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  service: string | null;
  requested_time: string | null;
  scheduled_at: string | null;
  status: Status;
  created_at: string;
  agents: { name: string } | null;
}

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "outline" | "destructive"> = {
  requested: "secondary",
  confirmed: "default",
  completed: "outline",
  cancelled: "destructive",
};

const STATUSES: Status[] = ["requested", "confirmed", "completed", "cancelled"];

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/appointments")
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (ok) setAppointments(data.appointments ?? []);
        else toast.error(data.error ?? "Could not load appointments");
      })
      .catch(() => !cancelled && toast.error("Could not load appointments"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function updateStatus(id: string, status: Status) {
    const prev = appointments;
    setAppointments((p) => p.map((a) => (a.id === id ? { ...a, status } : a)));
    const res = await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setAppointments(prev);
      toast.error("Failed to update appointment");
    } else {
      toast.success(`Marked as ${status}`);
    }
  }

  async function remove(id: string) {
    const prev = appointments;
    setAppointments((p) => p.filter((a) => a.id !== id));
    const res = await fetch(`/api/appointments/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setAppointments(prev);
      toast.error("Failed to delete appointment");
    } else {
      toast.success("Appointment deleted");
    }
  }

  return (
    <div>
      <PageHeader
        title="Appointments"
        description="Booking requests your agents took on calls — confirm the slot, then mark the outcome."
      />

      {loading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : appointments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-brand-border p-10 text-center">
          <p className="text-sm text-brand-muted">
            No appointments yet. When a caller asks to book, the request lands
            here with their details and preferred time.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-brand-border bg-brand-surface">
          <Table>
            <TableHeader>
              <TableRow className="border-brand-border hover:bg-transparent">
                <TableHead className="text-brand-muted">Customer</TableHead>
                <TableHead className="text-brand-muted">Service</TableHead>
                <TableHead className="text-brand-muted">Requested time</TableHead>
                <TableHead className="text-brand-muted">Agent</TableHead>
                <TableHead className="text-brand-muted">Taken</TableHead>
                <TableHead className="text-brand-muted">Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {appointments.map((appt) => (
                <TableRow key={appt.id} className="border-brand-border hover:bg-brand-surface-raised">
                  <TableCell>
                    <p className="font-medium text-brand-text">
                      {appt.customer_name ?? "Unknown caller"}
                    </p>
                    <p className="font-data text-xs text-brand-muted">
                      {appt.customer_phone ?? appt.customer_email ?? "—"}
                    </p>
                  </TableCell>
                  <TableCell className="text-brand-text">{appt.service ?? "—"}</TableCell>
                  <TableCell className="text-brand-text">{appt.requested_time ?? "—"}</TableCell>
                  <TableCell className="text-brand-muted">{appt.agents?.name ?? "—"}</TableCell>
                  <TableCell className="text-xs text-brand-muted">
                    {formatDistanceToNow(new Date(appt.created_at), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[appt.status] ?? "secondary"}>
                      {appt.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-brand-muted hover:text-brand-text">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="border-brand-border bg-brand-surface-raised">
                        {STATUSES.map((status) => (
                          <DropdownMenuItem
                            key={status}
                            onClick={() => updateStatus(appt.id, status)}
                            className="text-brand-text focus:bg-brand-violet/10 focus:text-brand-text"
                          >
                            Mark as {status}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => remove(appt.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="size-3.5" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
