import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  BriefcaseBusiness,
  BadgeDollarSign,
  UsersRound,
  RefreshCw,
  PackagePlus,
  ArrowRightLeft,
  ClipboardCheck,
  BadgePlus,
  UserRoundPlus,
  CloudUpload,
  FilePlus2,
  CircleDollarSign,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { hasAny, CONTENT_ROLES, LEAD_ROLES } from "@/lib/session";
import { ADMIN_MODULES } from "@/lib/admin-modules";
import { useAdminRoles } from "@/components/admin/AdminShell";
import {
  PageHeader,
  Panel,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  ModuleAvailabilityBadge,
  formatInt,
  formatDateTime,
} from "@/components/admin/ui";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: VisaoGeral,
  head: () => ({
    meta: [
      { title: "Inteligência Operacional — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

/** Saldo do livro-razão: valor real ou ausência explícita, nunca zero inventado. */
function LedgerBalance({
  icon: Icon,
  label,
  value,
  scope,
  pending,
}: {
  icon: LucideIcon;
  label: string;
  value: string | null;
  scope: string;
  pending?: boolean;
}) {
  return (
    <div className="border-b border-line-soft px-5 py-4 last:border-b-0">
      <p className="flex items-center gap-2 text-[0.75rem] text-ledger-muted">
        <Icon aria-hidden className="size-4" />
        {label}
      </p>
      {pending ? (
        <Skeleton className="mt-2 h-8 w-24" />
      ) : (
        <p className="num mt-1.5 text-[1.75rem] leading-none text-ledger-text">
          {value ?? "Sem dados"}
        </p>
      )}
      <p className="mt-1.5 text-[0.6875rem] text-ledger-muted">{scope}</p>
    </div>
  );
}

const SHORTCUTS: { label: string; icon: LucideIcon; module: string }[] = [
  { label: "Nova maleta", icon: BriefcaseBusiness, module: "maletas" },
  { label: "Lançar entrada", icon: PackagePlus, module: "estoque" },
  { label: "Transferir estoque", icon: ArrowRightLeft, module: "estoque" },
  { label: "Iniciar inventário", icon: ClipboardCheck, module: "estoque" },
  { label: "Novo produto", icon: BadgePlus, module: "cadastros" },
  { label: "Nova consultora", icon: UserRoundPlus, module: "consultoras" },
  { label: "Importar planilha", icon: CloudUpload, module: "importacao" },
  { label: "Novo título", icon: FilePlus2, module: "financeiro" },
  { label: "Registrar recebimento", icon: CircleDollarSign, module: "financeiro" },
];

function VisaoGeral() {
  const queryClient = useQueryClient();
  const roles = useAdminRoles();
  const podeConteudo = hasAny(roles, CONTENT_ROLES);
  const podeLeads = hasAny(roles, LEAD_ROLES);
  const podeAuditoria = hasAny(roles, ["master", "diretoria"]);

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

  const trilha = useQuery({
    queryKey: ["admin-audit-recent"],
    enabled: podeAuditoria,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id,action,entity,entity_id,created_at")
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data;
    },
  });

  async function assumirMaster() {
    const { error } = await supabase.rpc("claim_master_role");
    if (error) return;
    await queryClient.invalidateQueries();
  }

  const atualizadoEm = counts.dataUpdatedAt || trilha.dataUpdatedAt;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="VISÃO GERAL"
        title="Inteligência Operacional"
        description="Movimentação de estoque, finanças e operações da rede em um só lugar."
        actions={
          <button
            type="button"
            onClick={() => void queryClient.invalidateQueries()}
            className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-xs text-ledger-text transition-colors hover:bg-surface-muted"
          >
            <RefreshCw aria-hidden className="size-3.5" />
            Atualizar
            {atualizadoEm > 0 && (
              <span className="num text-ledger-muted">
                {formatDateTime(new Date(atualizadoEm).toISOString())}
              </span>
            )}
          </button>
        }
      />

      {roles.length === 0 && (
        <Panel title="Acesso">
          <div className="space-y-4 px-5 py-6">
            <p className="text-sm text-ledger-muted">
              A sua conta ainda não tem nenhum perfil de acesso. Sem perfil, nada do
              conteúdo ou das candidaturas fica visível.
            </p>
            {masterQuery.data === false && (
              <button type="button" onClick={assumirMaster} className="btn-premium">
                Assumir o perfil Master
              </button>
            )}
            {masterQuery.data === true && (
              <p className="text-sm text-ledger-muted">
                Já existe um Master nesta operação. Peça a ele para conceder o seu perfil.
              </p>
            )}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 xl:grid-cols-[22%_minmax(0,56%)_22%]">
        {/* Coluna esquerda */}
        <div className="flex flex-col gap-3">
          <Panel title="Principais saldos">
            <LedgerBalance
              icon={Boxes}
              label="Estoque central"
              value={null}
              scope="Motor de estoque em construção — nenhum saldo apurado."
            />
            <LedgerBalance
              icon={BriefcaseBusiness}
              label="Peças em maletas"
              value={null}
              scope="Depende do módulo Maletas."
            />
            <LedgerBalance
              icon={BadgeDollarSign}
              label="Valor nas ruas"
              value={null}
              scope="Só será exibido com custódia registrada."
            />
            <LedgerBalance
              icon={UsersRound}
              label="Candidaturas recebidas"
              value={
                podeLeads && counts.data?.leads != null ? formatInt(counts.data.leads) : null
              }
              pending={podeLeads && counts.isPending}
              scope={podeLeads ? "Seja Lardan — total no banco." : "Sem autorização."}
            />
          </Panel>

          {hasAny(roles, ["master", "diretoria", "financeiro"]) && (
            <Panel title="Indicadores financeiros">
              <EmptyState
                title="Nenhum título lançado"
                description="Recebimentos, contas a receber, inadimplência e contas a pagar aparecem aqui assim que o módulo Financeiro entrar em operação. Nada é estimado."
              />
            </Panel>
          )}
        </div>

        {/* Coluna central */}
        <div className="flex min-w-0 flex-col gap-3">
          <Panel
            title="Movimentações de estoque"
            action={<ModuleAvailabilityBadge state="em_construcao" />}
          >
            <EmptyState
              title="A razão de estoque ainda não recebeu movimentos"
              description="Entradas, saídas, transferências, reservas, maletas, vendas, devoluções e ajustes serão registrados aqui de forma imutável, com paginação no servidor. Nenhuma linha de demonstração é exibida."
              action={
                <Link to="/admin/estoque" className="admin-link mt-2">
                  Ver o módulo Estoque
                </Link>
              }
            />
          </Panel>

          <Panel title="Atalhos operacionais">
            <ul className="grid gap-2 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
              {SHORTCUTS.map((s) => {
                const mod = ADMIN_MODULES.find((m) => m.slug === s.module);
                if (!mod || !hasAny(roles, mod.roles)) return null;
                const Icon = s.icon;
                const disponivel = mod.state === "ativo";
                const conteudo = (
                  <span className="flex items-center gap-2.5">
                    <Icon aria-hidden className="size-4 text-bronze" />
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  </span>
                );
                return (
                  <li key={s.label}>
                    {disponivel && mod.path ? (
                      <Link
                        to={mod.path}
                        className="block rounded-[10px] border border-line-soft px-3 py-2.5 text-sm text-ledger-text transition-colors hover:bg-surface-muted"
                      >
                        {conteudo}
                      </Link>
                    ) : (
                      <span
                        aria-disabled="true"
                        title={`${s.label} — ${mod.state === "em_construcao" ? "em construção" : "em breve"}`}
                        className="block cursor-not-allowed rounded-[10px] border border-dashed border-line-soft px-3 py-2.5 text-sm text-ledger-muted"
                      >
                        {conteudo}
                        <span className="mt-1 block text-[0.625rem] uppercase tracking-[0.08em]">
                          {mod.state === "em_construcao" ? "Em construção" : "Em breve"}
                        </span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>

        {/* Coluna direita */}
        <div className="flex flex-col gap-3">
          <Panel title="Conciliação e status">
            <div className="px-5 py-5">
              <p className="text-sm text-ledger-text">Ainda não conciliado</p>
              <p className="mt-2 text-xs leading-relaxed text-ledger-muted">
                Não há inventário nem contagem registrada, portanto nenhum percentual
                de conciliação pode ser apurado.
              </p>
            </div>
          </Panel>

          <Panel title="Atenção operacional">
            <EmptyState
              title="Nenhum alerta apurável"
              description="Mínimos de SKU, ciclos de maleta, divergências de importação e títulos vencidos passam a alimentar este painel quando os módulos correspondentes entrarem em operação."
            />
          </Panel>

          <Panel title="Aprovações pendentes">
            <EmptyState
              title="Nenhuma aprovação na fila"
              description="Cargas iniciais, ajustes de estoque, divergências de inventário, estornos e mudanças sensíveis de permissão aparecerão aqui com protocolo e solicitante."
            />
          </Panel>
        </div>
      </div>

      {/* Faixa secundária: o que já é real hoje */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Catálogo e site">
          {podeConteudo ? (
            <dl className="grid grid-cols-2 gap-px bg-line-soft">
              {[
                ["Produtos cadastrados", counts.data?.produtos],
                ["Páginas do site", counts.data?.paginas],
                ["Candidaturas", counts.data?.leads],
                ["Mensagens de contato", counts.data?.mensagens],
              ].map(([label, value]) => (
                <div key={String(label)} className="bg-surface px-5 py-4">
                  <dt className="text-[0.75rem] text-ledger-muted">{label}</dt>
                  <dd className="num mt-1 text-2xl text-ledger-text">
                    {typeof value === "number" ? formatInt(value) : "—"}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <EmptyState
              title="Sem autorização"
              description="O seu perfil não tem acesso aos números de catálogo e site."
            />
          )}
        </Panel>

        <Panel title="Trilha de auditoria recente">
          {!podeAuditoria ? (
            <EmptyState
              title="Restrito"
              description="A trilha de auditoria é visível apenas para Master e Diretoria."
            />
          ) : trilha.isError ? (
            <ErrorState
              message="Não foi possível carregar a trilha."
              onRetry={() => void trilha.refetch()}
            />
          ) : trilha.isPending ? (
            <div className="space-y-2 px-5 py-4">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-5 w-3/5" />
            </div>
          ) : trilha.data.length === 0 ? (
            <EmptyState
              title="Nenhum registro ainda"
              description="Toda alteração em produtos, páginas, usuários, papéis e configurações é gravada aqui automaticamente."
            />
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line-soft text-[0.6875rem] uppercase tracking-[0.08em] text-ledger-muted">
                  <th className="px-5 py-2 font-normal">Data</th>
                  <th className="px-3 py-2 font-normal">Ação</th>
                  <th className="px-3 py-2 font-normal">Entidade</th>
                </tr>
              </thead>
              <tbody>
                {trilha.data.map((r) => (
                  <tr key={r.id} className="border-b border-line-soft last:border-b-0">
                    <td className="num whitespace-nowrap px-5 py-2 text-ledger-muted">
                      {formatDateTime(r.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone="neutral">{r.action}</StatusBadge>
                    </td>
                    <td className="truncate px-3 py-2 text-ledger-text">{r.entity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
