import Link from "next/link";
import {
  ArrowRight,
  PhoneCall,
  Bot,
  BarChart3,
  Zap,
  FileText,
  Lock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Waveform } from "@/components/voice/waveform";

const SAGE = "#A6BDA0";

const FEATURES = [
  {
    icon: Bot,
    title: "Build an agent in minutes",
    description:
      "Describe what your business does. VOXA writes the system prompt, picks a voice, and connects it to your knowledge base.",
  },
  {
    icon: PhoneCall,
    title: "Answers every call, instantly",
    description:
      "No hold music, no voicemail. Your agent picks up on the first ring, day or night, and hands off cleanly when it's stuck.",
  },
  {
    icon: BarChart3,
    title: "See what's actually happening",
    description:
      "Full transcripts, sentiment, and lead scoring on every call — so you know what your agent said, and what it should say next.",
  },
];

const TRUST = [
  { icon: PhoneCall, title: "24/7 answering", description: "Never miss a caller again" },
  { icon: Zap, title: "Instant setup", description: "Agent live in minutes" },
  { icon: FileText, title: "Full transcripts", description: "Every call, word for word" },
  { icon: Lock, title: "Secure by default", description: "Locked-down data access" },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-brand-bg">
      {/* announcement bar */}
      <div className="flex h-9 items-center justify-between bg-[#141414] px-5 font-data text-[10px] uppercase tracking-[0.18em] text-[#F2EDE0] md:px-8">
        <span>AI receptionist // answers every call // 24-7</span>
        <div className="hidden items-center gap-6 md:flex">
          <Link href="/sign-in" className="hover:opacity-70">Sign in</Link>
          <Link href="/sign-up" className="hover:opacity-70">Get started</Link>
        </div>
      </div>

      {/* header */}
      <header className="grid h-16 grid-cols-3 items-center border-b border-black/15 px-5 md:px-8" style={{ backgroundColor: SAGE }}>
        <nav className="hidden items-center gap-6 font-data text-[11px] uppercase tracking-[0.14em] text-black md:flex">
          <Link href="#product" className="hover:opacity-60">Product</Link>
          <Link href="#why" className="hover:opacity-60">Why VOXA</Link>
          <Link href="/dashboard" className="hover:opacity-60">Dashboard</Link>
        </nav>
        <div className="flex items-center justify-center gap-2.5">
          <Waveform barClassName="bg-black" />
          <span className="font-display text-lg font-bold uppercase tracking-[0.28em] text-black">
            VOXA
          </span>
        </div>
        <div className="flex items-center justify-end gap-3">
          <Button asChild variant="ghost" className="font-data text-[11px] uppercase tracking-[0.14em] text-black hover:bg-black/10 hover:text-black">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild className="rounded-none bg-black font-data text-[11px] uppercase tracking-[0.14em] text-[#F2EDE0] hover:bg-black/85">
            <Link href="/sign-up">Get started</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1">
        {/* hero — sage block like the poster */}
        <section
          className="relative overflow-hidden px-5 pb-16 pt-14 md:px-8 md:pb-24 md:pt-20"
          style={{ backgroundColor: SAGE }}
        >
          <div className="flex items-start justify-between">
            <p className="max-w-[18rem] font-data text-[11px] uppercase leading-5 tracking-[0.2em] text-black">
              Voice //
              <br /> that works while
              <br /> you don&apos;t.
            </p>
            <p className="text-right font-data text-[11px] uppercase leading-5 tracking-[0.2em] text-black">
              2026 // always on
            </p>
          </div>

          <h1 className="pointer-events-none select-none text-center font-display text-[26vw] font-bold leading-[0.85] tracking-[-0.02em] text-[#F2EDE0] md:text-[19rem]">
            VOXA
          </h1>

          <div className="mt-4 flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
            <div>
              <h2 className="mb-6 font-display text-4xl font-bold uppercase leading-[0.95] tracking-tight text-black md:text-5xl">
                Every call.
                <br /> Answered.
              </h2>
              <div className="flex items-center gap-3">
                <Button asChild size="lg" className="rounded-none bg-black px-8 font-data text-[11px] uppercase tracking-[0.16em] text-[#F2EDE0] hover:bg-black/85">
                  <Link href="/sign-up">
                    Start free <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="rounded-none border-black bg-transparent px-8 font-data text-[11px] uppercase tracking-[0.16em] text-black hover:bg-black hover:text-[#F2EDE0]"
                >
                  <Link href="/sign-in">Hear it answer</Link>
                </Button>
              </div>
            </div>
            <p className="text-right font-data text-[11px] uppercase leading-5 tracking-[0.2em] text-black">
              New //
              <br /> multilingual agents
            </p>
          </div>
        </section>

        {/* feature band — cream, numbered like a series */}
        <section id="product" className="border-b border-brand-border px-5 py-16 md:px-8 md:py-20">
          <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-3">
            {FEATURES.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="flex flex-col items-start gap-4">
                  <div className="flex w-full items-center justify-between">
                    <div className="flex size-12 items-center justify-center" style={{ backgroundColor: SAGE }}>
                      <Icon className="size-5 text-black" />
                    </div>
                    <span className="font-display text-5xl font-bold text-brand-border">
                      0{i + 1}
                    </span>
                  </div>
                  <h3 className="font-data text-xs font-semibold uppercase tracking-[0.16em] text-brand-text">
                    {feature.title}
                  </h3>
                  <p className="text-sm leading-6 text-brand-muted">
                    {feature.description}
                  </p>
                  <Link
                    href="/sign-up"
                    className="font-data text-[11px] uppercase tracking-[0.16em] text-brand-text underline underline-offset-4 hover:opacity-70"
                  >
                    Try it <ArrowRight className="inline size-3" />
                  </Link>
                </div>
              );
            })}
          </div>
        </section>

        {/* big statement — sage band */}
        <section id="why" className="px-5 py-20 md:px-8 md:py-28" style={{ backgroundColor: SAGE }}>
          <div className="mx-auto max-w-5xl">
            <p className="mb-6 font-data text-[11px] uppercase tracking-[0.2em] text-black/70">
              Every missed call // a lost customer
            </p>
            <h2 className="font-display text-5xl font-bold uppercase leading-[0.95] tracking-tight text-black md:text-7xl">
              Never miss
              <br /> a call.
            </h2>
            <p className="mt-6 max-w-md text-sm leading-6 text-black/75">
              VOXA picks up, speaks naturally, answers from your business
              knowledge, captures the lead, and books the appointment — then
              shows you the whole conversation.
            </p>
            <Button asChild size="lg" className="mt-8 rounded-none bg-black px-8 font-data text-[11px] uppercase tracking-[0.16em] text-[#F2EDE0] hover:bg-black/85">
              <Link href="/sign-up">
                Explore the dashboard <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </section>

        {/* trust strip */}
        <section className="px-5 py-12 md:px-8">
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-10 md:grid-cols-4">
            {TRUST.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex items-start gap-3">
                  <Icon className="mt-0.5 size-5 shrink-0 text-brand-text" />
                  <div>
                    <p className="font-data text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-text">
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs text-brand-muted">{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="flex h-14 items-center justify-between border-t border-brand-border px-5 font-data text-[10px] uppercase tracking-[0.18em] text-brand-muted md:px-8">
        <span>© 2026 VOXA // AI voice agents</span>
        <span>Season no. 01</span>
      </footer>
    </div>
  );
}
