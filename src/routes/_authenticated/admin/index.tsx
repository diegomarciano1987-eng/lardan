import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hasAny, CONTENT_ROLES, LEAD_ROLES } from "@/lib/session";
import { ADMIN_MODULES } from "@/lib/admin-modules";
import { StateBadge, useAdminRoles } from "@/components/admin/AdminShell";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: VisaoGeral,
  head: () => ({
    meta: [
      { title: "Visão geral — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <p className="brand-eyebrow mb-2">{label}</p>
      <p className="text-4xl text-foreground">{value ?? "—"}</p>
    </div>
  );
}

function VisaoGeral() {
  const queryClient = useQueryClient();
  const roles = useAdminRoles();
  const podeConteudo = hasAny(roles, CONTENT_ROLES);
  const podeLeads = hasAny(roles, LEAD_ROLES);

  const masterQuery = useQuery({
    queryKey: ["master-exists"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("master_exists");
      if (error) throw error;
      return Boolean(data);
    },
  });

  const counts = useQuery({
    queryKey: ["admin-counts", podeConteudo, podeLeads],
    enabled: podeConteudo || podeLeads,
    queryFn: async () => {
      const count = async (table: "leads" | "contact_requests" | "products" | "pages") => {
        const { count: c, error } = await supabase
          .from(table)
          .select("id", { count: "exact", head: true });
        if (error) throw error;
        return c ?? 0;
      };
      return {
        leads: podeLeads ? await count("leads") : null,
        mensagens: podeLeads ? await count("contact_requests") : null,
        produtos: podeConteudo ? await count("products") : null,
        paginas: podeConteudo ? await count("pages") : null,
      };
    },
  });

  async function assumirMaster() {
    const { error } = await supabase.rpc("claim_master_role");
    if (error) return;
    await queryClient.invalidateQueries();
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-3xl text-foreground">Visão geral</h1>

      {roles.length === 0 && (
        <div className="mt-8 rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            A sua conta ainda não tem nenhum perfil de acesso. Sem perfil, nada do
            conteúdo ou das candidaturas fica visível.
          </p>
          {masterQuery.data === false && (
            <button
              type="button"
              onClick={assumirMaster}
              className="btn-premium mt-6"
            >
              Assumir o perfil Master
            </button>
          )}
          {masterQuery.data === true && (
            <p className="mt-4 text-sm text-muted-foreground">
              Já existe um Master nesta operação. Peça a ele para conceder o seu
              perfil.
            </p>
          )}
        </div>
      )}

      {(podeConteudo || podeLeads) && (
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Candidaturas" value={counts.data?.leads ?? null} />
          <Metric label="Mensagens" value={counts.data?.mensagens ?? null} />
          <Metric label="Produtos" value={counts.data?.produtos ?? null} />
          <Metric label="Páginas" value={counts.data?.paginas ?? null} />
        </section>
      )}

      <section className="mt-10">
        <p className="brand-eyebrow mb-4">Módulos</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {ADMIN_MODULES.filter((m) => m.slug !== "visao-geral").map((m) => {
            const permitido = hasAny(roles, m.roles);
            const card = (
              <div
                className={`rounded-xl border border-border bg-card p-5 transition-colors ${
                  permitido ? "hover:border-primary/40" : "opacity-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base text-foreground">{m.label}</h2>
                  <StateBadge state={m.state} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{m.description}</p>
                {!permitido && (
                  <p className="mt-3 text-xs text-muted-foreground/70">
                    Sem perfil de acesso a este módulo.
                  </p>
                )}
              </div>
            );
            return permitido ? (
              <Link key={m.slug} to={m.path}>
                {card}
              </Link>
            ) : (
              <div key={m.slug}>{card}</div>
            );
          })}
        </div>
      </section>

      <p className="mt-10 text-sm leading-relaxed text-muted-foreground">
        Os números acima vêm direto do banco, sem dados de demonstração. Módulos
        desativados não executam nenhuma ação — apenas mostram a especificação.
      </p>
    </div>
  );
}
