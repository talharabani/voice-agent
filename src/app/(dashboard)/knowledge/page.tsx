"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Plus, FileText, Link2, HelpCircle, StickyNote, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type DocType = "pdf" | "docx" | "txt" | "url" | "faq" | "note";

const TYPE_ICON: Record<DocType, typeof FileText> = {
  pdf: FileText,
  docx: FileText,
  txt: FileText,
  url: Link2,
  faq: HelpCircle,
  note: StickyNote,
};

interface AgentOption {
  id: string;
  name: string;
}

interface KnowledgeDoc {
  id: string;
  name: string;
  type: DocType;
  content: string | null;
  url: string | null;
  created_at: string;
  agents: { id: string; name: string } | null;
}

export default function KnowledgePage() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);

  const [agentId, setAgentId] = useState<string>("");
  const [tab, setTab] = useState<"note" | "faq" | "url">("note");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");

  const load = useCallback(async () => {
    try {
      const [docsRes, agentsRes] = await Promise.all([
        fetch("/api/knowledge"),
        fetch("/api/agents"),
      ]);
      const docsData = await docsRes.json();
      const agentsData = await agentsRes.json();
      if (docsRes.ok) setDocs(docsData.docs ?? []);
      if (agentsRes.ok) {
        const list: AgentOption[] = (agentsData.agents ?? []).map(
          (a: { id: string; name: string }) => ({ id: a.id, name: a.name })
        );
        setAgents(list);
        if (list.length > 0) setAgentId((prev) => prev || list[0].id);
      }
    } catch {
      toast.error("Could not load knowledge base");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!agentId) {
      toast.error("Create an agent first, then add knowledge to it.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          type: tab,
          name,
          ...(tab === "url" ? { url } : { content }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to add source");
        return;
      }
      toast.success("Source added to knowledge base");
      setOpen(false);
      setName("");
      setContent("");
      setUrl("");
      void load();
    } catch {
      toast.error("Failed to add source");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const prev = docs;
    setDocs((d) => d.filter((doc) => doc.id !== id));
    const res = await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setDocs(prev);
      toast.error("Failed to delete source");
    } else {
      toast.success("Source removed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Knowledge"
        description="What your agents know — docs, FAQs, and notes they can reference on calls."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" />
                Add source
              </Button>
            </DialogTrigger>
            <DialogContent className="border-brand-border bg-brand-surface">
              <DialogHeader>
                <DialogTitle className="text-brand-text">Add a knowledge source</DialogTitle>
                <DialogDescription>
                  Write a note or FAQ, or link a page. Your agent uses this on calls.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleAdd} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Agent</Label>
                  <Select value={agentId} onValueChange={setAgentId}>
                    <SelectTrigger className="border-brand-border bg-brand-bg text-brand-text">
                      <SelectValue placeholder={agents.length ? "Choose an agent" : "No agents yet"} />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="note">Note</TabsTrigger>
                    <TabsTrigger value="faq">FAQ</TabsTrigger>
                    <TabsTrigger value="url">URL</TabsTrigger>
                  </TabsList>

                  <div className="flex flex-col gap-2 pt-4">
                    <Label htmlFor="source-name">Title</Label>
                    <Input
                      id="source-name"
                      placeholder="Cancellation policy"
                      required
                      maxLength={120}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>

                  <TabsContent value="note" className="flex flex-col gap-2 pt-4">
                    <Label htmlFor="note-content">Content</Label>
                    <Textarea
                      id="note-content"
                      placeholder="Cancellations within 24 hours incur a $25 fee..."
                      rows={5}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                    />
                  </TabsContent>
                  <TabsContent value="faq" className="flex flex-col gap-2 pt-4">
                    <Label htmlFor="faq-content">Questions &amp; answers</Label>
                    <Textarea
                      id="faq-content"
                      placeholder={"Q: Do you take walk-ins?\nA: Yes, weekdays before 4 PM."}
                      rows={5}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                    />
                  </TabsContent>
                  <TabsContent value="url" className="flex flex-col gap-2 pt-4">
                    <Label htmlFor="url-input">Page URL</Label>
                    <Input
                      id="url-input"
                      placeholder="https://yoursite.com/faq"
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  </TabsContent>
                </Tabs>

                <DialogFooter>
                  <Button type="submit" disabled={saving}>
                    {saving ? "Adding…" : "Add source"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-brand-border p-10 text-center">
          <p className="text-sm text-brand-muted">
            No knowledge sources yet. Add a note, FAQ, or URL — your agent will
            use it to answer callers.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((doc) => {
            const Icon = TYPE_ICON[doc.type] ?? FileText;
            return (
              <Card key={doc.id} className="border-brand-border bg-brand-surface">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex size-9 items-center justify-center rounded-md bg-brand-violet/10">
                      <Icon className="size-4 text-brand-text" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="border-brand-border text-brand-muted">
                        {doc.type}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-brand-muted hover:text-destructive"
                        onClick={() => handleDelete(doc.id)}
                        aria-label="Delete source"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  <CardTitle className="mt-2 text-sm text-brand-text">{doc.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-brand-muted">{doc.agents?.name ?? "—"}</p>
                  <p className="mt-1 text-xs text-brand-muted">
                    Added {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
