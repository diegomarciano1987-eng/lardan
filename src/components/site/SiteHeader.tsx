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
      className="relative px-3 py-2 text-[0.6875rem] tracking-[0.22em] uppercase text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      {label}
      <span
        aria-hidden
        className={`rose-rule absolute inset-x-3 bottom-0 transition-opacity duration-300 ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
    </Link>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <nav
        aria-label="Navegação principal"
        className="surface-glass hidden items-center rounded-full px-6 py-1 md:flex"
      >
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} label={item.label} />
        ))}
      </nav>

      {/* Cápsula compacta em telas estreitas */}
      <div className="md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="menu-mobile"
          onClick={() => setOpen((v) => !v)}
          className="surface-glass rounded-full px-5 py-2 text-[0.6875rem] tracking-[0.22em] uppercase text-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          {open ? "Fechar" : "Menu"}
        </button>
        {open && (
          <div
            id="menu-mobile"
            className="surface-glass mt-2 flex flex-col rounded-2xl p-2"
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
