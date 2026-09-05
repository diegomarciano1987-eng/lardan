import { createContext, useContext } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyRoles, hasAny, type AppRole } from "@/lib/session";
import { ADMIN_MODULES, STATE_LABEL, type ModuleState } from "@/lib/admin-modules";
import { cn } from "@/lib/utils";

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

export function StateBadge({ state }: { state: ModuleState }) {
  const styles: Record<ModuleState, string> = {
    ativo: "border-primary/40 text-foreground",
    em_implantacao: "border-border text-muted-foreground",
    desativado: "border-border/60 text-muted-foreground/60",
  };
  return (
    <span
      className={cn(
        "inline-block rounded-full border px-3 py-0.5 text-[0.625rem] tracking-[0.18em] uppercase",
        styles[state],
      )}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

/** Moldura da área administrativa: menu lateral, identidade e saída. */
export function AdminShell({
  email,
  children,
}: {
  email: string | undefined;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const rolesQuery = useQuery({ queryKey: ["my-roles"], queryFn: fetchMyRoles });
  const roles = rolesQuery.data ?? [];

  async function sair() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/acesso", replace: true });
  }

  const visible = ADMIN_MODULES.filter(
    (m) => m.slug === "visao-geral" || hasAny(roles, m.roles),
  );

  return (
    <RolesContext.Provider value={roles}>
      <div className="min-h-screen bg-background md:grid md:grid-cols-[16rem_1fr]">
        <aside className="border-b border-border md:border-b-0 md:border-r">
          <div className="flex items-center justify-between gap-4 px-6 py-6 md:flex-col md:items-start">
            <Link to="/admin" className="text-lg tracking-[0.3em] text-foreground">
              LARDAN
            </Link>
            <button
              type="button"
              onClick={sair}
              className="rounded-full border border-primary/40 px-5 py-1.5 text-[0.625rem] tracking-[0.22em] uppercase text-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              Sair
            </button>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-4 pb-4 md:flex-col md:overflow-visible md:px-3 md:pb-6">
            {visible.map((m) => {
              const active =
                m.path === "/admin" ? pathname === "/admin" : pathname.startsWith(m.path);
              return (
                <Link
                  key={m.slug}
                  to={m.path}
                  className={cn(
                    "whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    active
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  {m.label}
                </Link>
              );
            })}
          </nav>
          <div className="hidden border-t border-border px-6 py-4 md:block">
            <p className="truncate text-xs text-muted-foreground">{email}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <li
                  key={r}
                  className="rounded-full border border-border px-2.5 py-0.5 text-[0.625rem] text-foreground"
                >
                  {ROLE_LABEL[r]}
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <main className="min-w-0 px-6 py-10 md:px-10">{children}</main>
      </div>
    </RolesContext.Provider>
  );
}

/** Página padrão de módulo ainda não operacional: estado honesto, sem ação fingida. */
export function ModulePlaceholder({ slug }: { slug: string }) {
  const mod = ADMIN_MODULES.find((m) => m.slug === slug);
  if (!mod) return null;
  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl text-foreground">{mod.label}</h1>
        <StateBadge state={mod.state} />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{mod.description}</p>
      <div className="mt-8 rounded-xl border border-border bg-card p-6">
        <p className="brand-eyebrow mb-3">Especificação do módulo</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{mod.spec}</p>
        <p className="mt-6 text-sm text-muted-foreground">
          Nenhuma ação operacional está ativa aqui. Quando o módulo entrar em
          implantação, esta página passa a mostrar dados reais — nunca números
          de demonstração.
        </p>
      </div>
    </div>
  );
}
