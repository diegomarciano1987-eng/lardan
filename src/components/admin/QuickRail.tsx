import { Link, useRouterState } from "@tanstack/react-router";
import {
  Boxes,
  LayoutDashboard,
  ShieldCheck,
  ShoppingBag,
  Sprout,
  Users,
  type LucideIcon,
} from "lucide-react";

type Shortcut = { to: string; label: string; icon: LucideIcon };

const SHORTCUTS: Shortcut[] = [
  { to: "/admin", label: "Visão geral", icon: LayoutDashboard },
  { to: "/admin/cadastros", label: "Cadastros", icon: Boxes },
  { to: "/admin/operacao", label: "Operação", icon: ShoppingBag },
  { to: "/admin/crescimento", label: "Crescimento", icon: Sprout },
  { to: "/admin/usuarios", label: "Usuários e papéis", icon: Users },
  { to: "/admin/auditoria", label: "Auditoria", icon: ShieldCheck },
];

export function QuickRail() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (to: string) => (to === "/admin" ? pathname === "/admin" : pathname.startsWith(to));

  return (
    <nav
      aria-label="Atalhos rápidos"
      className="fixed left-[15px] top-1/2 z-30 hidden -translate-y-1/2 md:block"
    >
      <div className="flex flex-col items-center gap-1.5 rounded-full border border-white/10 bg-ink/95 p-2 shadow-[0_24px_50px_-20px_rgba(23,21,18,0.6)] backdrop-blur-sm">
        {SHORTCUTS.map(({ to, label, icon: Icon }) => {
          const active = isActive(to);
          return (
            <div key={to} className="group relative">
              <Link
                to={to}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne ${
                  active
                    ? "bg-champagne/15 text-champagne"
                    : "text-warm-ivory/45 hover:bg-white/[0.07] hover:text-warm-ivory"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.8} />
                <span
                  aria-hidden
                  className={`absolute -left-[9px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-champagne transition-all duration-300 ${
                    active ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0"
                  }`}
                />
              </Link>
              <span
                role="tooltip"
                className="pointer-events-none absolute left-full top-1/2 ml-4 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-full border border-white/10 bg-ink px-3.5 py-1.5 font-admin text-[0.6875rem] font-medium tracking-[0.08em] text-warm-ivory opacity-0 shadow-[0_16px_32px_-14px_rgba(23,21,18,0.55)] transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100"
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
