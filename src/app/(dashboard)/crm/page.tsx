"use client";

import { useEffect, useState } from "react";
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

type Status = "new" | "contacted" | "qualified" | "won" | "lost";

interface Lead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  status: Status;
  lead_score: number;
  created_at: string;
  agents: { name: string } | null;
}

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "outline" | "destructive"> = {
  new: "secondary",
  contacted: "outline",
  qualified: "default",
  won: "default",
  lost: "destructive",
};

const STATUSES: Status[] = ["new", "contacted", "qualified", "won", "lost"];

export default function CrmPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/leads")
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (ok) setLeads(data.leads ?? []);
        else toast.error(data.error ?? "Could not load leads");
      })
      .catch(() => !cancelled && toast.error("Could not load leads"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function updateStatus(id: string, status: Status) {
    const prev = leads;
    setLeads((p) => p.map((l) => (l.id === id ? { ...l, status } : l)));
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setLeads(prev);
      toast.error("Failed to update lead");
    } else {
      toast.success(`Marked as ${status}`);
    }
  }

  async function deleteLead(id: string) {
    const prev = leads;
    setLeads((p) => p.filter((l) => l.id !== id));
    const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setLeads(prev);
      toast.error("Failed to delete lead");
    } else {
      toast.success("Lead deleted");
    }
  }

  return (
    <div>
      <PageHeader
        title="CRM"
        description="Leads your agents have captured, ready to follow up on."
      />

      {loading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : leads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-brand-border p-10 text-center">
          <p className="text-sm text-brand-muted">
            No leads yet. When a caller shares their name, number, or email on
            a call, it lands here automatically.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-brand-border bg-brand-surface">
          <Table>
            <TableHeader>
              <TableRow className="border-brand-border hover:bg-transparent">
                <TableHead className="text-brand-muted">Name</TableHead>
                <TableHead className="text-brand-muted">Contact</TableHead>
                <TableHead className="text-brand-muted">Agent</TableHead>
                <TableHead className="text-brand-muted">Tags</TableHead>
                <TableHead className="text-brand-muted">Score</TableHead>
                <TableHead className="text-brand-muted">Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id} className="border-brand-border hover:bg-brand-surface-raised">
                  <TableCell className="font-medium text-brand-text">
                    {lead.name ?? "Unknown caller"}
                  </TableCell>
                  <TableCell>
                    <p className="text-xs text-brand-text">{lead.email ?? "—"}</p>
                    <p className="font-data text-xs text-brand-muted">{lead.phone ?? "—"}</p>
                  </TableCell>
                  <TableCell className="text-brand-muted">{lead.agents?.name ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {lead.tags.length === 0 && (
                        <span className="text-xs text-brand-muted">—</span>
                      )}
                      {lead.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="border-brand-border text-brand-muted"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-brand-text">{lead.lead_score}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[lead.status] ?? "secondary"}>
                      {lead.status}
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
                            onClick={() => updateStatus(lead.id, status)}
                            className="text-brand-text focus:bg-brand-violet/10 focus:text-brand-text"
                          >
                            Mark as {status}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => deleteLead(lead.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="size-3.5" /> Delete lead
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
