import { createContext, useContext, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Bell, LogOut, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyRoles, type AppRole } from "@/lib/session";
import { findModule } from "@/lib/admin-modules";
import { BottomDock } from "@/components/admin/BottomDock";
import { CommandPalette } from "@/components/admin/CommandPalette";
import { ModuleAvailabilityBadge, PageHeader, Panel } from "@/components/admin/ui";
import logo from "@/assets/lardan-logo-completa.png.asset.json";

const RolesContext = createContext<AppRole[]>([]);
export const useAdminRoles = () => useContext(RolesContext);

export const ROLE_LABEL: Record<AppRole, string> = {
  master: "Master",
  diretoria: "Diretoria",
  marketing: "Marketing",
  suporte: "Suporte",
  financeiro: "Financeiro",
  cobranca: "Cobrança",
  estoque: "Estoque",
  montagem: "Montagem",
  qualidade: "Qualidade",
  representante: "Representante",
  consultora: "Consultora",
};

export { ModuleAvailabilityBadge as StateBadge };

/** Moldura global do Lardan OS: cabeçalho, busca e menu inferior flutuante. */
export function AdminShell({
  email,
  children,
}: {
  email: string | undefined;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rolesQuery = useQuery({ queryKey: ["my-roles"], queryFn: fetchMyRoles });
  const roles = rolesQuery.data ?? [];
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function sair() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/acesso", replace: true });
  }

  const initials = (email ?? "?").slice(0, 2).toUpperCase();

  return (
    <RolesContext.Provider value={roles}>
      <div className="min-h-screen bg-warm-ivory text-ledger-text">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line-soft bg-surface pr-3">
          <Link
            to="/admin"
            className="flex h-16 w-[220px] shrink-0 items-center gap-3 bg-ink px-5 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-champagne lg:w-[320px]"
          >
            <img src={logo.url} alt="Lardan" className="h-6 w-auto" />
            <span className="hidden text-[0.625rem] tracking-[0.28em] text-warm-ivory/70 sm:block">
              LARDAN OS
            </span>
          </Link>

          <button
            type="button"
            onClick={() => setPalette(true)}
            className="hidden min-w-0 flex-1 items-center gap-3 rounded-[10px] border border-line-soft bg-warm-ivory px-4 py-2.5 text-left text-sm text-ledger-muted transition-colors hover:border-line md:flex"
          >
            <Search aria-hidden className="size-4" />
            <span className="min-w-0 flex-1 truncate">
              Buscar por SKU, produto, código, consultora, maleta, cliente, título...
            </span>
            <kbd className="rounded border border-line px-1.5 py-0.5 text-[0.6875rem] num">
              {mac ? "⌘ K" : "Ctrl K"}
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => setPalette(true)}
            aria-label="Buscar"
            className="ml-auto rounded-[10px] border border-line-soft p-2 text-ledger-muted md:hidden"
          >
            <Search className="size-4" />
          </button>

          <button
            type="button"
            aria-label="Notificações"
            title="Notificações — nenhuma fonte de alerta está ativa nesta fase"
            className="relative rounded-[10px] border border-line-soft p-2 text-ledger-muted"
          >
            <Bell className="size-4" />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((v) => !v)}
              className="flex items-center gap-2 rounded-[10px] border border-line-soft px-2 py-1.5 text-left"
            >
              <span className="grid size-7 place-items-center rounded-lg bg-ink text-[0.625rem] text-warm-ivory">
                {initials}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block max-w-36 truncate text-xs text-ledger-text">
                  {email ?? "Conta"}
                </span>
                <span className="block text-[0.625rem] text-ledger-muted">
                  {roles.length ? roles.map((r) => ROLE_LABEL[r]).join(" · ") : "Sem papel"}
                </span>
              </span>
              <ChevronDown aria-hidden className="size-3.5 text-ledger-muted" />
            </button>
            {menu && (
              <div className="absolute right-0 top-[calc(100%+8px)] w-56 rounded-xl border border-line-soft bg-surface p-2 shadow-xl">
                <p className="px-2 py-1 text-[0.6875rem] text-ledger-muted">{email}</p>
                <button
                  type="button"
                  onClick={sair}
                  className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-ledger-text hover:bg-surface-muted"
                >
                  <LogOut aria-hidden className="size-4" /> Sair
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto min-w-0 max-w-[1600px] px-5 pb-40 pt-8 md:px-8">{children}</main>

        <BottomDock roles={roles} />
        <CommandPalette open={palette} onClose={() => setPalette(false)} roles={roles} />
      </div>
    </RolesContext.Provider>
  );
}

/** Página padrão de módulo ainda não operacional: estado honesto, sem ação fingida. */
export function ModulePlaceholder({ slug }: { slug: string }) {
  const mod = findModule(slug);
  if (!mod) return null;
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={mod.state === "em_construcao" ? "EM CONSTRUÇÃO" : "MÓDULO"}
        title={mod.label}
        description={mod.description}
        actions={<ModuleAvailabilityBadge state={mod.state} />}
      />
      <Panel title="Especificação do módulo" className="max-w-3xl">
        <div className="space-y-4 px-5 py-6">
          <p className="text-sm leading-relaxed text-ledger-muted">{mod.spec}</p>
          <p className="text-sm leading-relaxed text-ledger-muted">
            Nenhuma ação operacional está ativa aqui e nenhum número é exibido. Quando
            o módulo entrar em operação, esta página passa a mostrar dados reais.
          </p>
        </div>
      </Panel>
    </div>
  );
}
