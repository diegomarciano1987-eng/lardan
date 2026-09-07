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

      <HeaderAcoes className="absolute right-5 top-1/2 hidden -translate-y-1/2 md:flex md:right-10" />

      <div className="absolute right-5 top-1/2 z-50 flex -translate-y-1/2 items-center gap-2 md:hidden">
        <HeaderAcoes />
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-controls="menu-mobile"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-foreground/10 bg-background/55 text-foreground/75 backdrop-blur-xl transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          {open ? <X className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.4} /> : <Menu className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.4} />}
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
