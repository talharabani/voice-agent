"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Phone, PhoneCall, Trash2, Link2 } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Waveform } from "@/components/voice/waveform";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface Agent {
  id: string;
  name: string;
  description: string | null;
  greeting: string | null;
  system_prompt: string | null;
  business_type: string | null;
  voice: string;
  is_active: boolean;
  share_token: string;
}

export default function AgentsPage() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);

  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [greeting, setGreeting] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [voice, setVoice] = useState("warm-female");
  const [speechLanguage, setSpeechLanguage] = useState('ur');

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      if (res.ok) setAgents(data.agents ?? []);
      else toast.error(data.error ?? "Could not load agents");
    } catch {
      toast.error("Could not load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          voice,
          language: speechLanguage,
          ...(businessType ? { business_type: businessType } : {}),
          ...(greeting ? { greeting } : {}),
          ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to create agent");
        return;
      }
      toast.success("Agent created — now test a call!");
      setOpen(false);
      setName("");
      setBusinessType("");
      setGreeting("");
      setSystemPrompt("");
      void load();
    } catch {
      toast.error("Failed to create agent");
    } finally {
      setSaving(false);
    }
  }

  async function copyCallLink(agent: Agent) {
    const url = `${window.location.origin}/call/${agent.share_token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Call link copied — share it anywhere");
    } catch {
      toast.info(url);
    }
  }

  async function handleDelete(id: string) {
    const prev = agents;
    setAgents((a) => a.filter((agent) => agent.id !== id));
    const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setAgents(prev);
      toast.error("Failed to delete agent");
    } else {
      toast.success("Agent deleted");
    }
  }

  return (
    <div>
      <PageHeader
        title="Agents"
        description="Voice agents you've configured for your business."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" />
                New agent
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto border-brand-border bg-brand-surface">
              <DialogHeader>
                <DialogTitle className="text-brand-text">Create an agent</DialogTitle>
                <DialogDescription>
                  Give your agent a name, a voice, and a job to do.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="agent-name">Name</Label>
                  <Input
                    id="agent-name"
                    placeholder="Front Desk — Acme Co."
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="agent-business">Business type</Label>
                  <Input
                    id="agent-business"
                    placeholder="dental clinic"
                    maxLength={120}
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="agent-greeting">Greeting</Label>
                  <Textarea
                    id="agent-greeting"
                    placeholder="Thanks for calling Acme — how can I help today?"
                    value={greeting}
                    onChange={(e) => setGreeting(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="agent-prompt">Instructions (optional)</Label>
                  <Textarea
                    id="agent-prompt"
                    placeholder="You help patients book cleanings and answer insurance questions. Be warm and brief."
                    rows={3}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="agent-voice">Voice</Label>
                  <Select value={voice} onValueChange={setVoice}>
                    <SelectTrigger id="agent-voice" className="w-full">
                      <SelectValue placeholder="Choose a voice" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="warm-female">Warm female</SelectItem>
                      <SelectItem value="clear-female">Clear female</SelectItem>
                      <SelectItem value="calm-male">Calm male</SelectItem>
                      <SelectItem value="deep-male">Deep male</SelectItem>
                      <SelectItem value="youthful">Youthful</SelectItem>
                      <SelectItem value="gentle">Gentle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2"><Label htmlFor="agent-speech-language">Default microphone language</Label><Select value={speechLanguage} onValueChange={setSpeechLanguage}><SelectTrigger id="agent-speech-language"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ur">Urdu</SelectItem><SelectItem value="en">English</SelectItem><SelectItem value="pa">Punjabi</SelectItem><SelectItem value="hi">Hindi</SelectItem></SelectContent></Select><p className="text-xs text-brand-muted">Start with the language your patients speak most. Callers can change it before speaking.</p></div>
                <DialogFooter>
                  <Button type="submit" disabled={saving}>
                    {saving ? "Creating…" : "Create agent"}
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
            <Skeleton key={i} className="h-44 rounded-lg" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-brand-border p-10 text-center">
          <p className="text-sm text-brand-muted">
            No agents yet. Click <span className="font-medium text-brand-text">New agent</span>,
            give it a name and greeting, then hit <span className="font-medium text-brand-text">Test call</span> to
            talk to it.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Card key={agent.id} className="border-brand-border bg-brand-surface">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex size-9 items-center justify-center rounded-full bg-[#A6BDA0]/40">
                    <Waveform className="scale-75" active={agent.is_active} />
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={agent.is_active ? "default" : "secondary"}>
                      {agent.is_active ? "Active" : "Paused"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-brand-muted hover:text-destructive"
                      onClick={() => handleDelete(agent.id)}
                      aria-label="Delete agent"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <CardTitle className="mt-2 text-brand-text">{agent.name}</CardTitle>
                <CardDescription>
                  {agent.description ?? agent.business_type ?? "Voice agent"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-brand-muted">
                    <Phone className="size-3.5" />
                    {agent.greeting ? "Greeting set" : "No greeting"}
                  </span>
                  <span className="font-data text-xs text-brand-muted">
                    voice: {agent.voice}
                  </span>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button asChild size="sm" className="flex-1">
                    <Link href={`/agents/${agent.id}/call-test`}>
                      <PhoneCall className="size-3.5" />
                      Test call
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-brand-border text-brand-text hover:bg-brand-surface-raised"
                    onClick={() => copyCallLink(agent)}
                  >
                    <Link2 className="size-3.5" />
                    Call link
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
