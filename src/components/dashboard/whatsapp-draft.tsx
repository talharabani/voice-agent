'use client';
import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function WhatsAppDraft({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ message: string; url: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setError(''); setDraft(null);
    fetch(`/api/appointments/${id}/whatsapp-draft`, { signal: controller.signal }).then(async res => {
      const data = await res.json(); if (!res.ok) throw new Error(data.error ?? 'Could not prepare message');
      setDraft(data);
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [id, open]);
  return <><Button variant="outline" onClick={() => setOpen(true)}><MessageCircle className="size-4" />WhatsApp message</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto border-brand-border bg-brand-surface text-brand-text"><DialogTitle>Review WhatsApp message</DialogTitle><DialogDescription>This opens the patient's chat in WhatsApp. You must press Send there; opening a draft does not mean it was delivered.</DialogDescription>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : !draft ? <p className="text-sm text-brand-muted">Preparing clinic and appointment details...</p> : <><pre className="whitespace-pre-wrap rounded-xl border border-brand-border bg-brand-bg p-4 font-body text-sm leading-relaxed">{draft.message}</pre><Button asChild><a href={draft.url} target="_blank" rel="noopener noreferrer">Open WhatsApp to send</a></Button><p className="text-xs text-brand-muted">Manual sending works without a Meta API template. Automatic sending requires the configured WhatsApp Business sender and approved template.</p></>}
  </DialogContent></Dialog></>;
}
