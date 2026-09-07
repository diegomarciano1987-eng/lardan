import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { HeaderAcoes } from "./HeaderAcoes";
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === "/";

  return (
    <header
      className={`fixed inset-x-0 z-50 flex items-center justify-center px-5 ${
        branded
          ? "top-0 h-[4.5rem] border-b border-foreground/10 bg-background/82 shadow-[0_16px_42px_-34px_color-mix(in_oklab,var(--foreground)_28%,transparent)] backdrop-blur-xl md:h-24"
          : "top-6 h-[4.5rem] md:h-16"
      }`}
    >
      {branded ? (
        <Link
          to="/"
          aria-label="Lardan — página inicial"
          className="absolute left-5 bottom-2.5 flex h-9 items-center px-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring md:bottom-auto md:left-10 md:h-24"
        >
          <img
            src={logo.url}
            alt="Lardan"
            width={200}
            height={56}
            className="h-5 w-auto object-contain brightness-[0.32] sepia-[0.18] transition-opacity duration-300 hover:opacity-70 md:h-12"
          />
        </Link>
      ) : null}

      <nav aria-label="Navegação principal" className="hidden items-center gap-2 md:flex">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} label={item.label} />
        ))}
      </nav>

      <HeaderAcoes className="absolute right-5 top-1/2 hidden -translate-y-1/2 md:flex md:right-10" />

      <div className="absolute inset-x-5 bottom-2.5 z-50 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center md:hidden">
        <span aria-hidden />

        <div className="relative flex flex-col items-center">
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-controls="menu-mobile"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-foreground/10 bg-background/55 px-4 text-[0.5625rem] tracking-[0.24em] uppercase text-foreground/75 backdrop-blur-xl transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            {open ? <X className="h-3.5 w-3.5" strokeWidth={1.4} /> : <Menu className="h-3.5 w-3.5" strokeWidth={1.4} />}
            Menu
          </button>
          {open && (
            <div
              id="menu-mobile"
              className={`absolute left-1/2 top-full mt-3 flex max-h-[calc(100vh-8rem)] w-56 -translate-x-1/2 flex-col items-center gap-3 overflow-y-auto rounded-2xl border border-foreground/10 px-7 py-7 shadow-[0_28px_70px_-30px_color-mix(in_oklab,var(--foreground)_55%,transparent)] ${
                isHome ? "bg-background/70 backdrop-blur-2xl" : "bg-background"
              }`}
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

        <HeaderAcoes className="justify-self-end [&_a]:h-9 [&_a]:w-9" />
      </div>

    </header>
  );
}
