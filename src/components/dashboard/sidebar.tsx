"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Bot,
  MessagesSquare,
  BookOpen,
  BarChart3,
  CalendarCheck,
  Users,
  Settings,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Waveform } from "@/components/voice/waveform";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/appointments", label: "Appointments", icon: CalendarCheck },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/crm", label: "CRM", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface Usage {
  plan: string;
  limit: number;
  used: number;
}

export function Sidebar() {
  const pathname = usePathname();
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setUsage(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-[#111111] md:flex">
      <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-5">
        <Waveform barClassName="bg-white" />
        <span className="font-display text-base font-bold uppercase tracking-[0.22em] text-white">
          VOXA
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-sm px-3 py-2.5 text-xs font-medium uppercase tracking-[0.14em] transition-colors",
                isActive
                  ? "bg-[#A6BDA0] text-black"
                  : "text-neutral-400 hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="rounded-sm bg-white/5 px-3 py-2.5 text-xs text-neutral-400">
          <span className="font-data font-medium uppercase tracking-[0.12em] text-white">
            {usage ? `${usage.plan} plan` : "Free plan"}
          </span>
          <div className="mt-1.5 h-1 overflow-hidden rounded-sm bg-white/10">
            <div
              className="h-full bg-[#A6BDA0] transition-all"
              style={{
                width: usage
                  ? `${Math.min(100, (usage.used / usage.limit) * 100)}%`
                  : "0%",
              }}
            />
          </div>
          <p className="mt-1 font-data text-[10px]">
            {usage
              ? `${usage.used} / ${usage.limit} calls this month`
              : "50 calls/mo included"}
          </p>
        </div>
      </div>
    </aside>
  );
}
