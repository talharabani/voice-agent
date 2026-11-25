'use client';

import { useState } from 'react';
import {
  Award,
  BadgeCheck,
  Clock3,
  Languages,
  Stethoscope,
  ArrowUpRight,
  GraduationCap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { PublicDoctor } from '@/types/database';

export function DoctorCard({
  doctor,
  highlighted = false,
  onAsk,
}: {
  doctor: PublicDoctor;
  highlighted?: boolean;
  onAsk?: (doctor: PublicDoctor) => void;
}) {
  const [brokenPhoto, setBrokenPhoto] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const initials = doctor.name
    .replace(/^dr\.?\s*/i, '')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <article
      id={`doctor-${doctor.id}`}
      className={`doctor-profile scroll-mt-6 overflow-hidden rounded-2xl border bg-brand-surface-raised text-left transition-all ${
        highlighted
          ? 'border-brand-teal shadow-[0_0_0_3px_#7e9b7628]'
          : 'border-brand-border hover:border-brand-teal/60'
      }`}
    >
      {/* Top Oladoc-style header */}
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            <div className="flex size-20 items-center justify-center overflow-hidden rounded-full border-2 border-brand-teal/40 bg-brand-teal/15 font-display text-xl font-semibold text-brand-text shadow-xs">
              {doctor.photo_url && !brokenPhoto ? (
                <img
                  src={doctor.photo_url}
                  alt={doctor.name}
                  className="size-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setBrokenPhoto(true)}
                />
              ) : (
                initials || 'DR'
              )}
            </div>
            <span
              title="Verified Clinic Doctor"
              className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border-2 border-brand-surface-raised bg-[#1F7A52] text-white"
            >
              <BadgeCheck className="size-3.5" />
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#1F7A52]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#1F7A52]">
                Verified
              </span>
              {highlighted && (
                <span className="rounded-full bg-brand-teal/20 px-2.5 py-0.5 text-[10px] font-medium text-brand-text">
                  Recommended
                </span>
              )}
            </div>
            <h3 className="mt-1.5 font-display text-lg font-semibold leading-snug text-brand-text">
              {doctor.name}
            </h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-brand-muted">
              <Stethoscope className="size-3.5 shrink-0 text-brand-teal" />
              {doctor.specialty}
            </p>
            {doctor.qualifications && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-brand-muted">
                <GraduationCap className="size-3.5 shrink-0" />
                {doctor.qualifications}
              </p>
            )}
          </div>
        </div>

        {/* Oladoc-style 3-column stat bar */}
        <div className="mt-4 grid grid-cols-3 divide-x divide-brand-border rounded-xl border border-brand-border bg-brand-bg/60 py-2.5 text-center">
          <div className="px-2">
            <p className="font-display text-sm font-semibold text-brand-text">
              {doctor.experience_years} Yrs
            </p>
            <p className="text-[10px] text-brand-muted">Experience</p>
          </div>
          <div className="px-2">
            <p className="truncate font-display text-sm font-semibold text-brand-text">
              {doctor.languages.length ? doctor.languages.slice(0, 2).join(', ') : 'Urdu, Eng'}
            </p>
            <p className="text-[10px] text-brand-muted">Languages</p>
          </div>
          <div className="px-2">
            <p className="font-display text-sm font-semibold text-[#1F7A52]">Available</p>
            <p className="text-[10px] text-brand-muted">In-Clinic</p>
          </div>
        </div>

        {/* Timings & Languages */}
        <div className="mt-4 space-y-2 text-xs text-brand-muted">
          {doctor.availability && (
            <p className="flex items-start gap-2 rounded-lg bg-brand-surface px-3 py-2 text-brand-text">
              <Clock3 className="mt-0.5 size-3.5 shrink-0 text-brand-teal" />
              <span>{doctor.availability}</span>
            </p>
          )}
          {doctor.languages.length > 0 && (
            <p className="flex items-center gap-2 px-1">
              <Languages className="size-3.5 shrink-0" />
              Speaks: {doctor.languages.join(', ')}
            </p>
          )}
        </div>

        {/* Expandable Oladoc-style full bio & expertise */}
        {(doctor.description || doctor.concern_keywords.length > 0) && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-brand-text hover:underline"
            >
              <Award className="size-3.5 text-brand-teal" />
              {expanded ? 'Hide full profile' : 'View full profile & services'}
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>

            {expanded && (
              <div className="mt-3 space-y-3 border-t border-brand-border pt-3">
                {doctor.description && (
                  <p className="whitespace-pre-line text-xs leading-relaxed text-brand-muted">
                    {doctor.description}
                  </p>
                )}
                {doctor.concern_keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {doctor.concern_keywords.slice(0, 10).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-brand-border bg-brand-bg px-2.5 py-0.5 text-[10px] text-brand-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {onAsk && (
        <div className="border-t border-brand-border bg-brand-bg/50 px-5 py-3">
          <button
            type="button"
            onClick={() => onAsk(doctor)}
            className="flex w-full items-center justify-between rounded-xl bg-brand-text px-4 py-2.5 text-xs font-medium text-brand-bg transition-opacity hover:opacity-90"
          >
            <span>Book / Ask about {doctor.name}</span>
            <ArrowUpRight className="size-4" />
          </button>
        </div>
      )}
    </article>
  );
}
