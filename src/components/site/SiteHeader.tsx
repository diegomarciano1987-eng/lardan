import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { NAV_ITEMS } from "@/lib/brand";
import logo from "@/assets/lardan-logo-completa.png.asset.json";

function NavLink({
  to,
  label,
  onNavigate,
}: {
  to: string;
  label: string;
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className="group relative px-4 py-2 text-[0.6875rem] tracking-[0.22em] uppercase text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      {label}
      <span
        aria-hidden
        className={`absolute inset-x-4 bottom-0 h-px origin-left bg-foreground/60 transition-transform duration-300 ${
          active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
        }`}
      />
    </Link>
  );
}

export function SiteHeader({ branded = false }: { branded?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <header
      className={`fixed inset-x-0 z-50 flex items-center justify-center px-5 ${
        branded
          ? "top-0 h-24 border-b border-foreground/10 bg-background/82 shadow-[0_16px_42px_-34px_color-mix(in_oklab,var(--foreground)_28%,transparent)] backdrop-blur-xl"
          : "top-6 h-16"
      }`}
    >
      {branded ? (
        <Link
          to="/"
          aria-label="Lardan — página inicial"
          className="absolute left-5 flex h-16 items-center px-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring md:left-10"
        >
          <img
            src={logo.url}
            alt="Lardan"
            width={200}
            height={56}
            className="h-10 w-auto object-contain brightness-[0.32] sepia-[0.18] transition-opacity duration-300 hover:opacity-70 md:h-12"
          />
        </Link>
      ) : null}

      <nav aria-label="Navegação principal" className="hidden items-center gap-2 md:flex">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} label={item.label} />
        ))}
      </nav>

      <div className="absolute right-5 top-1/2 z-50 -translate-y-1/2 md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="menu-mobile"
          onClick={() => setOpen((v) => !v)}
          className="border-b border-foreground/40 px-2 pb-1 text-[0.6875rem] tracking-[0.22em] uppercase text-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          {open ? "Fechar" : "Menu"}
        </button>
        {open && (
          <div
            id="menu-mobile"
            className="absolute right-0 top-full mt-3 flex max-h-[calc(100vh-6rem)] w-56 flex-col items-center gap-3 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.03] px-7 py-7 shadow-[0_24px_60px_-24px_oklch(0.25_0.02_30/0.18)] backdrop-blur-2xl"
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                label={item.label}
                onNavigate={() => setOpen(false)}
              />
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
