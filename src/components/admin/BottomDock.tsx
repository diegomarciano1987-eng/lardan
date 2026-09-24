import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { MoreHorizontal, Lock, Clock3, X, ChevronRight, ArrowLeft } from "lucide-react";
import { ADMIN_MODULES, moduleAllowed, type AdminModule } from "@/lib/admin-modules";
import { useCapabilities } from "@/lib/capabilities";
import { AREAS_FINANCEIRAS } from "@/components/admin/financeiro/FinanceiroShell";
import wordmark from "@/assets/lardan-wordmark.png.asset.json";
import { hasAny, type AppRole } from "@/lib/session";
import { cn } from "@/lib/utils";

function isActive(pathname: string, path?: string) {
  if (!path) return false;
  return path === "/admin" ? pathname === "/admin" : pathname.startsWith(path);
}

function ItemLabel({ m }: { m: AdminModule }) {
  const Icon = m.icon;
  return (
    <>
      <Icon aria-hidden className="size-[18px] shrink-0" />
      <span className="truncate">{m.label}</span>
      {m.state === "em_breve" && <Lock aria-hidden className="size-3 opacity-70" />}
      {m.state === "em_construcao" && <Clock3 aria-hidden className="size-3 opacity-70" />}
    </>
  );
}

/** Menu principal flutuante inferior: única navegação global do sistema. */
export function BottomDock({ roles }: { roles: AppRole[] }) {
  const caps = useCapabilities();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [drawer, setDrawer] = useState(false);
  const [submenu, setSubmenu] = useState<"modulos" | "financeiro">("modulos");

  const permitted = ADMIN_MODULES.filter((m) => moduleAllowed(m, caps, roles));
  const primary = permitted.slice(0, 5);
  const areasFinanceiras = AREAS_FINANCEIRAS.filter((a) => caps.includes(a.capacidade));
  const fecharGaveta = () => {
    setDrawer(false);
    setSubmenu("modulos");
  };
  const abrirFinanceiro = () => {
    setSubmenu("financeiro");
    setDrawer(true);
  };

  const itemClass = (m: AdminModule, active: boolean) =>
    cn(
      "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[0.8125rem] font-semibold whitespace-nowrap transition-colors duration-150",
      active
        ? "bg-champagne-soft text-ink"
        : "text-warm-ivory/85 hover:bg-white/8 hover:text-warm-ivory",
      m.state === "em_breve" && "cursor-not-allowed opacity-45 hover:bg-transparent",
    );

  return (
    <>
      {/* Gaveta de módulos */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 pb-28">
          <div className="w-full max-w-3xl rounded-2xl border border-line-soft bg-surface p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              {submenu === "financeiro" ? (
                <button
                  type="button"
                  onClick={() => setSubmenu("modulos")}
                  className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-semibold text-ledger-text hover:bg-surface-muted"
                >
                  <ArrowLeft aria-hidden className="size-4" />
                  <span className="ledger-eyebrow">Financeiro</span>
                </button>
              ) : (
                <p className="ledger-eyebrow">Todos os módulos</p>
              )}
              <button
                type="button"
                onClick={fecharGaveta}
                aria-label="Fechar módulos"
                className="rounded-lg p-1 text-ledger-muted hover:bg-surface-muted"
              >
                <X className="size-4" />
              </button>
            </div>

            {submenu === "financeiro" ? (
              <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {areasFinanceiras.map((a) => {
                  const active =
                    a.to === "/admin/financeiro" ? pathname === a.to : pathname.startsWith(a.to);
                  return (
                    <li key={a.to}>
                      <Link
                        to={a.to}
                        onClick={fecharGaveta}
                        title={a.descricao}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-ledger-text transition-colors hover:bg-surface-muted",
                          active && "bg-champagne-soft",
                        )}
                      >
                        <span className="truncate">{a.label}</span>
                        {a.emImplantacao && (
                          <span className="ml-auto shrink-0 text-[0.625rem] uppercase tracking-[0.08em] text-warning">
                            Em implantação
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {permitted.map((m) => {
                  const active = isActive(pathname, m.path);
                  const Icon = m.icon;
                  const body = (
                    <span className="flex items-center gap-2.5">
                      <Icon aria-hidden className="size-[18px] shrink-0" />
                      <span className="truncate">{m.label}</span>
                      {m.slug === "financeiro" && (
                        <ChevronRight aria-hidden className="ml-auto size-4 shrink-0 opacity-70" />
                      )}
                      {m.state === "em_breve" && (
                        <span className="ml-auto text-[0.625rem] uppercase tracking-[0.08em] text-ledger-muted">
                          Em breve
                        </span>
                      )}
                      {m.state === "em_construcao" && (
                        <span className="ml-auto text-[0.625rem] uppercase tracking-[0.08em] text-warning">
                          Em construção
                        </span>
                      )}
                    </span>
                  );
                  return (
                    <li key={m.slug}>
                      {m.slug === "financeiro" ? (
                        <button
                          type="button"
                          onClick={() => setSubmenu("financeiro")}
                          aria-haspopup="true"
                          className={cn(
                            "block w-full rounded-lg px-3 py-2.5 text-left text-sm text-ledger-text transition-colors hover:bg-surface-muted",
                            active && "bg-champagne-soft",
                          )}
                        >
                          {body}
                        </button>
                      ) : m.path ? (
                        <Link
                          to={m.path}
                          onClick={fecharGaveta}
                          className={cn(
                            "block rounded-lg px-3 py-2.5 text-sm text-ledger-text transition-colors hover:bg-surface-muted",
                            active && "bg-champagne-soft",
                          )}
                        >
                          {body}
                        </Link>
                      ) : (
                        <span
                          aria-disabled="true"
                          title={`${m.label}: ${m.description}`}
                          className="block cursor-not-allowed rounded-lg px-3 py-2.5 text-sm text-ledger-muted opacity-60"
                        >
                          {body}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <nav
        aria-label="Módulos do sistema"
        data-bottom-dock className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(18px,env(safe-area-inset-bottom))]"
      >
        <div className="flex w-full max-w-[94vw] items-center gap-2 rounded-[24px] border border-white/8 bg-ink px-3 py-2 shadow-[0_18px_40px_-16px_rgba(24,24,23,0.65)]">
          <Link to="/admin" className="hidden shrink-0 px-2 lg:block" aria-label="Lardan — visão geral">
            <img src={wordmark.url} alt="Lardan" className="h-4 w-auto opacity-80" />
          </Link>

          {/* Desktop: todos os módulos com rolagem controlada */}
          <ul className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex [scrollbar-width:none]">
            {permitted.map((m) => {
              const active = isActive(pathname, m.path);
              return (
                <li key={m.slug}>
                  {m.slug === "financeiro" ? (
                    <button
                      type="button"
                      onClick={abrirFinanceiro}
                      aria-haspopup="dialog"
                      aria-expanded={drawer && submenu === "financeiro"}
                      className={itemClass(m, active)}
                      title="Abrir áreas do Financeiro"
                    >
                      <ItemLabel m={m} />
                    </button>
                  ) : m.path ? (
                    <Link to={m.path} className={itemClass(m, active)} title={m.description}>
                      <ItemLabel m={m} />
                    </Link>
                  ) : (
                    <span
                      aria-disabled="true"
                      title={`${m.label} — em breve. ${m.description}`}
                      className={itemClass(m, false)}
                    >
                      <ItemLabel m={m} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Mobile: cinco destinos + Mais */}
          <ul className="flex min-w-0 flex-1 items-center justify-between gap-1 md:hidden">
            {primary.map((m) => {
              const active = isActive(pathname, m.path);
              const Icon = m.icon;
              return (
                <li key={m.slug}>
                  {m.slug === "financeiro" ? (
                    <button
                      type="button"
                      onClick={abrirFinanceiro}
                      aria-label="Abrir áreas do Financeiro"
                      aria-haspopup="dialog"
                      aria-expanded={drawer && submenu === "financeiro"}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-xl px-2.5 py-1.5 text-[0.625rem]",
                        active ? "bg-champagne-soft text-ink" : "text-warm-ivory/80",
                      )}
                    >
                      <Icon aria-hidden className="size-[18px]" />
                      <span className="max-w-14 truncate">{m.label}</span>
                    </button>
                  ) : m.path ? (
                    <Link
                      to={m.path}
                      aria-label={m.label}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-xl px-2.5 py-1.5 text-[0.625rem]",
                        active ? "bg-champagne-soft text-ink" : "text-warm-ivory/80",
                      )}
                    >
                      <Icon aria-hidden className="size-[18px]" />
                      <span className="max-w-14 truncate">{m.label}</span>
                    </Link>
                  ) : (
                    <span
                      aria-disabled="true"
                      className="flex flex-col items-center gap-1 px-2.5 py-1.5 text-[0.625rem] text-warm-ivory/40"
                    >
                      <Icon aria-hidden className="size-[18px]" />
                      <span className="max-w-14 truncate">{m.label}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={() => {
              setDrawer((v) => !v);
              setSubmenu("modulos");
            }}
            className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-[0.75rem] text-warm-ivory/85 transition-colors hover:bg-white/8"
          >
            <MoreHorizontal aria-hidden className="size-4" />
            <span className="hidden sm:inline">Mais módulos</span>
          </button>
        </div>
      </nav>
    </>
  );
}
