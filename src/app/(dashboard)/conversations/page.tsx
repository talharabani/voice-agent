"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

type Sentiment = "positive" | "neutral" | "negative";

interface ConversationRow {
  id: string;
  call_sid: string | null;
  sentiment: Sentiment;
  lead_score: number;
  duration_seconds: number | null;
  created_at: string;
  transcript: { role: string; content: string }[];
}

const SENTIMENT_VARIANT: Record<Sentiment, "default" | "secondary" | "destructive"> = {
  positive: "default",
  neutral: "secondary",
  negative: "destructive",
};

function formatDuration(secs: number | null) {
  if (!secs) return "—";
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ConversationRow | null>(null);

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => {
        setConversations(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        title="Conversations"
        description="Every call your agents have handled, with transcripts and outcomes."
      />

      <div className="overflow-hidden rounded-lg border border-brand-border bg-brand-surface">
        <Table>
          <TableHeader>
            <TableRow className="border-brand-border hover:bg-transparent">
              <TableHead className="text-brand-muted">Call ID</TableHead>
              <TableHead className="text-brand-muted">Duration</TableHead>
              <TableHead className="text-brand-muted">Sentiment</TableHead>
              <TableHead className="text-brand-muted">Lead score</TableHead>
              <TableHead className="text-brand-muted">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i} className="border-brand-border">
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                </TableRow>
              ))
            ) : conversations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-brand-muted py-8">
                  No conversations yet. Run a test curl command to see data here.
                </TableCell>
              </TableRow>
            ) : (
              conversations.map((c) => (
                <TableRow
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="cursor-pointer border-brand-border hover:bg-brand-surface-raised"
                >
                  <TableCell className="font-medium text-brand-text font-data">
                    {c.call_sid ?? c.id.slice(0, 8)}
                  </TableCell>
                  <TableCell className="text-brand-muted">
                    {formatDuration(c.duration_seconds)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={SENTIMENT_VARIANT[c.sentiment as Sentiment] ?? "secondary"}>
                      {c.sentiment ?? "unknown"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-brand-text">
                    {c.lead_score ?? 0}
                  </TableCell>
                  <TableCell className="text-brand-muted">
                    {formatDate(c.created_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="border-brand-border bg-brand-surface">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="text-brand-text font-data">
                  {selected.call_sid ?? selected.id}
                </SheetTitle>
                <SheetDescription>
                  {formatDate(selected.created_at)} ·{" "}
                  {formatDuration(selected.duration_seconds)} ·
                  Lead score: {selected.lead_score ?? 0}
                </SheetDescription>
              </SheetHeader>
              <Separator className="bg-brand-border" />
              <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
                {(!selected.transcript || selected.transcript.length === 0) ? (
                  <p className="text-sm text-brand-muted py-4 text-center">
                    No transcript available.
                  </p>
                ) : (
                  selected.transcript.map((turn, i) => (
                    <div
                      key={i}
                      className={
                        turn.role === "assistant"
                          ? "self-start max-w-[85%] rounded-lg rounded-tl-sm bg-brand-violet/15 px-3 py-2 text-sm text-brand-text"
                          : "self-end max-w-[85%] rounded-lg rounded-tr-sm bg-brand-surface-raised px-3 py-2 text-sm text-brand-text"
                      }
                    >
                      <p className="mb-1 font-data text-[10px] uppercase tracking-wide text-brand-muted">
                        {turn.role === "assistant" ? "Agent" : "Caller"}
                      </p>
                      {turn.content}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
