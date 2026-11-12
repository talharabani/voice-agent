import { UserButton } from "@clerk/nextjs";
import { Bell } from "lucide-react";
import Link from 'next/link';

import { Button } from "@/components/ui/button";

export function Topbar() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-brand-border bg-brand-bg px-5 md:px-8">
      <div className="font-display text-xs uppercase tracking-[0.16em] text-brand-muted">
        VOXA / Workspace
      </div>
      <div className="flex items-center gap-3">
        <details className="relative md:hidden"><summary className="cursor-pointer text-xs font-medium">Menu</summary><nav className="absolute right-0 top-8 z-40 grid min-w-44 gap-1 rounded-xl border border-brand-border bg-brand-surface p-2 shadow-lg">{[['/dashboard', 'Overview'], ['/agents', 'Agents'], ['/doctors', 'Doctors'], ['/appointments', 'Appointments'], ['/conversations', 'Conversations'], ['/settings', 'Clinic settings']].map(([href, label]) => <Link key={href} href={href} className="rounded-lg px-3 py-2 text-sm hover:bg-brand-bg">{label}</Link>)}</nav></details>
        <Button variant="ghost" size="icon" className="text-brand-muted hover:text-brand-text">
          <Bell className="size-4" />
        </Button>
        <UserButton
          appearance={{
            variables: {
              colorPrimary: "#111111",
              colorBackground: "#F6F5F1",
              colorForeground: "#141414",
            },
          }}
        />
      </div>
    </header>
  );
}
