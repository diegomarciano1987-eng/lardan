import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyRoles, hasAny, CONTENT_ROLES, LEAD_ROLES, type AppRole } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
  head: () => ({
    meta: [
      { title: "Administração — LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const ROLE_LABEL: Record<AppRole, string> = {
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

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <p className="brand-eyebrow mb-2">{label}</p>
      <p className="text-4xl text-foreground">{value ?? "—"}</p>
    </div>
  );
}

function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = Route.useRouteContext();

  const rolesQuery = useQuery({ queryKey: ["my-roles"], queryFn: fetchMyRoles });
  const roles = rolesQuery.data ?? [];
  const podeConteudo = hasAny(roles, CONTENT_ROLES);
  const podeLeads = hasAny(roles, LEAD_ROLES);

  const masterQuery = useQuery({
    queryKey: ["master-exists"],
    enabled: rolesQuery.isSuccess && roles.length === 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("master_exists");
      if (error) throw error;
      return Boolean(data);
    },
  });

  const counts = useQuery({
    queryKey: ["admin-counts", podeConteudo, podeLeads],
    enabled: rolesQuery.isSuccess && (podeConteudo || podeLeads),
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

  async function sair() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/acesso", replace: true });
  }

  return (
    <div className="min-h-screen bg-background px-6 py-16">
      <div className="mx-auto max-w-4xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-8">
          <div>
            <p className="brand-eyebrow mb-2">Área restrita</p>
            <h1 className="text-3xl text-foreground">Administração Lardan</h1>
            <p className="mt-2 text-sm text-muted-foreground">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={sair}
            className="rounded-full border border-primary/40 px-6 py-2 text-[0.6875rem] tracking-[0.22em] uppercase text-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            Sair
          </button>
        </header>

        <section className="mt-8">
          <p className="brand-eyebrow mb-3">Seus perfis</p>
          {rolesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : roles.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <li
                  key={r}
                  className="rounded-full border border-border px-4 py-1 text-xs text-foreground"
                >
                  {ROLE_LABEL[r]}
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-border bg-card p-6">
              <p className="text-sm text-muted-foreground">
                A sua conta ainda não tem nenhum perfil de acesso. Sem perfil, nada
                do conteúdo ou das candidaturas fica visível.
              </p>
              {masterQuery.data === false && (
                <button
                  type="button"
                  onClick={assumirMaster}
                  className="mt-6 rounded-full bg-primary px-7 py-3 text-[0.75rem] tracking-[0.22em] uppercase text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Assumir o perfil Master
                </button>
              )}
              {masterQuery.data === true && (
                <p className="mt-4 text-sm text-muted-foreground">
                  Já existe um Master nesta operação. Peça a ele para conceder o
                  seu perfil.
                </p>
              )}
            </div>
          )}
        </section>

        {(podeConteudo || podeLeads) && (
          <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Candidaturas" value={counts.data?.leads ?? null} />
            <Metric label="Mensagens" value={counts.data?.mensagens ?? null} />
            <Metric label="Produtos" value={counts.data?.produtos ?? null} />
            <Metric label="Páginas" value={counts.data?.paginas ?? null} />
          </section>
        )}

        <p className="mt-12 text-sm leading-relaxed text-muted-foreground">
          Os números acima vêm direto do banco, sem dados de demonstração. As telas
          de edição de conteúdo, produtos e candidaturas entram na próxima etapa.
        </p>
      </div>
    </div>
  );
}
