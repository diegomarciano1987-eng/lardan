import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { NAV_ITEMS } from "@/lib/brand";

function NavLink({ to, label, onNavigate }: { to: string; label: string; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active =
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
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

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-6 z-50 flex justify-center px-4">
      <nav aria-label="Navegação principal" className="hidden items-center gap-2 md:flex">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} label={item.label} />
        ))}
      </nav>

      <div className="md:hidden">
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
            className="mt-4 flex flex-col items-center gap-1 bg-background/85 px-6 py-4 backdrop-blur-sm"
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
