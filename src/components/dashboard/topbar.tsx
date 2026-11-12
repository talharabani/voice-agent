import { UserButton } from "@clerk/nextjs";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";

export function Topbar() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-brand-border bg-brand-bg px-5 md:px-8">
      <div className="font-display text-xs uppercase tracking-[0.16em] text-brand-muted">
        VOXA / Workspace
      </div>
      <div className="flex items-center gap-3">
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
