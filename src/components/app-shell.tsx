"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { LayoutDashboard, Plus, Settings as SettingsIcon, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/customers", label: "Customers", icon: Users, exact: false },
  { href: "/settings", label: "Settings", icon: SettingsIcon, exact: false },
] as const;

function useOllamaStatus() {
  const [state, setState] = useState<{ online: boolean | null; demo: boolean }>({
    online: null,
    demo: false,
  });
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/ai/models", { cache: "no-store" });
        const data = (await res.json()) as { online?: boolean; demo?: boolean };
        if (!cancelled) {
          setState({ online: Boolean(data.online), demo: Boolean(data.demo) });
        }
      } catch {
        if (!cancelled) setState((current) => ({ ...current, online: false }));
      }
    };
    void check();
    const timer = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return state;
}

function OllamaStatus({ online }: { online: boolean | null }) {
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-2 rounded-full",
          online === null ? "bg-amber-400" : online ? "bg-emerald-500" : "bg-red-400",
        )}
      />
      {online === null ? "Checking Ollama…" : online ? "Ollama online" : "Ollama offline"}
    </div>
  );
}

function isActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname.startsWith(href);
}

function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = isActive(pathname, href, exact);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function MobileNav() {
  const pathname = usePathname();
  return NAV.map(({ href, label, exact }) => {
    const active = isActive(pathname, href, exact);
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          "rounded-md px-2.5 py-1.5 text-sm",
          active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground",
        )}
      >
        {label}
      </Link>
    );
  });
}

function NavFallback({ mobile = false }: { mobile?: boolean }) {
  if (mobile) {
    return NAV.map(({ href, label }) => (
      <Link key={href} href={href} className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground">
        {label}
      </Link>
    ));
  }
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground"
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { online, demo } = useOllamaStatus();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r bg-card px-4 py-5 md:flex print:hidden">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-1">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-mono text-sm font-bold text-primary-foreground">
            T
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold">Ticky</span>
            <span className="block text-xs text-muted-foreground">Invoicing</span>
          </span>
        </Link>

        <Button render={<Link href="/invoices/new" />} className="mb-5 w-full justify-start gap-2">
          <Plus data-icon="inline-start" className="size-4" />
          New invoice
        </Button>

        <Suspense fallback={<NavFallback />}>
          <DesktopNav />
        </Suspense>

        <div className="mt-auto">
          <OllamaStatus online={online} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center gap-1 border-b bg-card px-4 py-2.5 md:hidden print:hidden">
        <Link href="/" className="mr-2 flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-primary font-mono text-xs font-bold text-primary-foreground">
            T
          </span>
          <span className="text-sm font-semibold">Ticky</span>
        </Link>
        <Suspense fallback={<NavFallback mobile />}>
          <MobileNav />
        </Suspense>
        <Button size="icon" render={<Link href="/invoices/new" />} className="ml-auto" title="New invoice">
          <Plus className="size-4" />
        </Button>
      </header>

      {/* Demo banner: hosted sandbox — data resets, AI is desktop-only */}
      {demo && (
        <div className="border-b bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900 md:pl-60 dark:bg-amber-950 dark:text-amber-200 print:hidden">
          Hosted demo — data resets periodically and everything you enter is public. The AI copilot
          runs only in the desktop app.
        </div>
      )}

      <main className="md:pl-60">{children}</main>
    </div>
  );
}
