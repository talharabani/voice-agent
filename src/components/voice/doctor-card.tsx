'use client';
import { useState } from 'react';
import { Award, Clock3, Languages, Stethoscope, ArrowUpRight } from 'lucide-react';
import type { PublicDoctor } from '@/types/database';

export function DoctorCard({ doctor, highlighted = false, onAsk }: { doctor: PublicDoctor; highlighted?: boolean; onAsk?: (doctor: PublicDoctor) => void }) {
  const [brokenPhoto, setBrokenPhoto] = useState(false);
  return <article id={`doctor-${doctor.id}`} className={`doctor-profile scroll-mt-6 rounded-2xl border bg-brand-surface-raised p-5 text-left transition-all ${highlighted ? 'border-brand-teal shadow-[0_0_0_3px_#7e9b7620]' : 'border-brand-border'}`}>
    <div className="flex items-start gap-4">
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-brand-teal/20 font-display text-xl text-brand-text">
        {doctor.photo_url && !brokenPhoto ? <img src={doctor.photo_url} alt={doctor.name} className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => setBrokenPhoto(true)} /> : doctor.name.replace(/^dr\.?\s*/i, '').split(' ').map(part => part[0]).slice(0, 2).join('')}
      </div>
      <div className="min-w-0"><p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-brand-muted"><Stethoscope className="size-3.5" />{doctor.specialty}</p><h3 className="font-display text-lg leading-tight">{doctor.name}</h3>{doctor.qualifications && <p className="mt-1 text-xs text-brand-muted">{doctor.qualifications}</p>}</div>
    </div>
    <div className="mt-4 flex flex-wrap gap-2"><span className="inline-flex items-center gap-1 rounded-full bg-brand-bg px-2.5 py-1 text-[11px]"><Award className="size-3" />{doctor.experience_years} years experience</span>{highlighted && <span className="rounded-full bg-brand-teal/20 px-2.5 py-1 text-[11px]">Related profile</span>}</div>
    {doctor.description && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-brand-muted">{doctor.description}</p>}
    <div className="mt-4 space-y-2 border-t border-brand-border pt-4 text-xs text-brand-muted">{doctor.availability && <p className="flex items-start gap-2"><Clock3 className="mt-0.5 size-3.5 shrink-0" />{doctor.availability}</p>}{doctor.languages.length > 0 && <p className="flex items-center gap-2"><Languages className="size-3.5" />{doctor.languages.join(', ')}</p>}</div>
    {onAsk && <button onClick={() => onAsk(doctor)} className="mt-4 flex w-full items-center justify-between rounded-lg bg-brand-bg px-3 py-2.5 text-xs font-medium hover:bg-brand-teal/20">Ask about this doctor<ArrowUpRight className="size-4" /></button>}
  </article>;
}
