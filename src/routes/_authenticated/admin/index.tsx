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
import { moduleAllowed, ADMIN_MODULES } from "@/lib/admin-modules";
import { useCapabilities } from "@/lib/capabilities";
import { fetchFinOverviewPeriodo } from "@/lib/financeiro";

import { VisaoGeralPainel } from "@/components/admin/VisaoGeralPainel";
import { VisaoGeralColaboradora } from "@/components/admin/VisaoGeralColaboradora";
import { useColabEscopo } from "@/lib/colab-escopo";
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
  formatBRLFromCents,
} from "@/components/admin/ui";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: VisaoGeral,
  head: () => ({
    meta: [
      { title: "Visão Geral — Administração LARDAN" },
      { name: "description", content: "Resumo operacional ou trabalho pessoal conforme o acesso autorizado LARDAN." },
      { property: "og:title", content: "Visão Geral — Administração LARDAN" },
      { property: "og:description", content: "Resumo operacional ou trabalho pessoal conforme o acesso autorizado LARDAN." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
    <div className="border-b border-line-soft px-5 py-5 last:border-b-0">
      <p className="flex items-center gap-2 text-[0.78rem] font-semibold tracking-wide text-ledger-muted">
        <Icon aria-hidden className="size-4 text-bronze" />
        {label}
      </p>
      {pending ? (
        <Skeleton className="mt-2 h-9 w-24" />
      ) : (
        <p className="num mt-2 font-display text-[2rem] font-semibold leading-none text-ledger-text">
          {value ?? "Sem dados"}
        </p>
      )}
      <p className="mt-2 text-[0.72rem] font-medium leading-relaxed text-ledger-muted">{scope}</p>
    </div>
  );
}

const SHORTCUTS: { label: string; icon: LucideIcon; module: string; to?: string }[] = [
  { label: "Nova maleta", icon: BriefcaseBusiness, module: "maletas" },
  { label: "Lançar entrada", icon: PackagePlus, module: "estoque" },
  { label: "Transferir estoque", icon: ArrowRightLeft, module: "estoque" },
  { label: "Iniciar inventário", icon: ClipboardCheck, module: "estoque" },
  { label: "Novo produto", icon: BadgePlus, module: "cadastros" },
  { label: "Nova consultora", icon: UserRoundPlus, module: "consultoras" },
  { label: "Importar planilha", icon: CloudUpload, module: "importacao" },
  {
    label: "Novo título a pagar",
    icon: FilePlus2,
    module: "financeiro",
    to: "/admin/financeiro/pagar",
  },
  {
    label: "Registrar recebimento",
    icon: CircleDollarSign,
    module: "financeiro",
    to: "/admin/financeiro/receber",
  },
];

function VisaoGeral() {
  const escopo = useColabEscopo();
  if (escopo.isPending) return <Skeleton className="h-40" />;
  if (escopo.isError) return <ErrorState message="Não foi possível conferir seu acesso." onRetry={() => void escopo.refetch()} />;
  return escopo.data?.colaboradora ? <VisaoGeralColaboradora /> : <VisaoGeralAdministrativa />;
}

function VisaoGeralAdministrativa() {
  const queryClient = useQueryClient();
  const roles = useAdminRoles();
  const caps = useCapabilities();
  const podeConteudo = caps.includes("catalog.view");
  const podeLeads = caps.includes("leads.view");
  const podeAuditoria = caps.includes("audit.view");

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
    staleTime: 5 * 60_000,
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

  const valorRuas = useQuery({
    queryKey: ["catalog-street-value"],
    enabled: podeConteudo,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("catalog_street_value");
      if (error) throw error;
      return data as { total_cents: number; pecas: number; custo_cents: number | null };
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

  const finHome = useQuery({
    queryKey: ["fin-overview", "admin-home"],
    queryFn: () => fetchFinOverviewPeriodo(),
    enabled: caps.includes("finance.view"),
    staleTime: 60_000,
  });

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
        <Panel title="Acesso" flush>
          <div className="space-y-4 px-5 py-6">
            <p className="text-sm text-ledger-muted">
              A sua conta ainda não tem nenhum perfil de acesso. Sem perfil, nada do conteúdo ou das
              candidaturas fica visível.
            </p>
            {masterQuery.data === false && (
              <button type="button" onClick={assumirMaster} className="admin-btn-primary">
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

      {caps.includes("finance.view") ? (
        <VisaoGeralPainel
          saldoContas={finHome.data?.saldo_contas_cents}
          vencidoReceber={finHome.data?.vencido_receber_cents}
          vencidoPagar={finHome.data?.vencido_pagar_cents}
        />
      ) : null}

      <HistoricoUnificado />
    </div>
  );
}

type MesUnificado = { mes: string; sd_maletas: number; sd_enviado_cents: number; sd_vendido_cents: number; ld_maletas: number; ld_enviado_cents: number; ld_vendido_cents: number };

/** SmallData + Lardan mês a mês: o histórico que ficou para trás somado à operação atual. Dados só do banco. */
function HistoricoUnificado() {
  const q = useQuery({
    queryKey: ["visao-unificada-mensal", 12],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("visao_unificada_mensal" as never, { _meses: 12 } as never);
      if (error) throw error;
      return (data ?? []) as unknown as MesUnificado[];
    },
  });
  if (q.isError && (q.error as { code?: string }).code === "42501") return null;
  if (q.isError) return <Panel title="Histórico unificado · SmallData + Lardan"><ErrorState message="Não foi possível carregar o histórico unificado." onRetry={() => void q.refetch()} /></Panel>;
  const l = q.data ?? [];
  const tot = l.reduce((t, m) => ({
    maletas: t.maletas + m.sd_maletas + m.ld_maletas,
    enviado: t.enviado + Number(m.sd_enviado_cents) + Number(m.ld_enviado_cents),
    vendido: t.vendido + Number(m.sd_vendido_cents) + Number(m.ld_vendido_cents),
  }), { maletas: 0, enviado: 0, vendido: 0 });
  const max = Math.max(1, ...l.map((m) => Number(m.sd_enviado_cents) + Number(m.ld_enviado_cents)));
  const mesBR = (m: string) => { const [a, mm] = m.split("-"); return `${mm}/${a?.slice(2)}`; };
  return (
    <Panel title="Histórico unificado · SmallData + Lardan (12 meses)">
      {q.isPending ? <Skeleton className="h-40" /> : l.length === 0 ? (
        <EmptyState title="Sem dados" description="Nenhuma maleta enviada ou acertada nos últimos 12 meses." />
      ) : (
        <div className="space-y-5">
          <dl className="grid gap-3 sm:grid-cols-3">
            {[["Maletas enviadas", formatInt(tot.maletas)], ["Valor enviado", formatBRLFromCents(tot.enviado)], ["Vendido nos acertos", formatBRLFromCents(tot.vendido)]].map(([t, v]) => (
              <div key={t} className="rounded-xl border border-line-soft bg-surface px-4 py-3">
                <dt className="text-[0.78rem] font-semibold text-ledger-muted">{t}</dt>
                <dd className="num mt-1 font-display text-2xl font-semibold text-ledger-text">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex items-center gap-4 text-xs text-ledger-muted">
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-bronze/60" /> SmallData</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" /> Lardan</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-line text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-bronze">
                <th className="py-2 pr-3">Mês</th><th className="px-3 py-2">Valor enviado</th><th className="px-3 py-2 text-right">Maletas SD / Lardan</th><th className="px-3 py-2 text-right">Enviado</th><th className="py-2 pl-3 text-right">Vendido</th>
              </tr></thead>
              <tbody>
                {l.map((m) => {
                  const sd = Number(m.sd_enviado_cents), ld = Number(m.ld_enviado_cents);
                  return (
                    <tr key={m.mes} className="border-b border-line-soft last:border-b-0">
                      <td className="num py-2 pr-3 font-semibold text-ledger-text">{mesBR(m.mes)}</td>
                      <td className="w-[40%] px-3 py-2">
                        <div className="flex h-3 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                          <span className="bg-bronze/60" style={{ width: `${(sd / max) * 100}%` }} />
                          <span className="bg-primary" style={{ width: `${(ld / max) * 100}%` }} />
                        </div>
                      </td>
                      <td className="num px-3 py-2 text-right text-ledger-muted">{formatInt(m.sd_maletas)} / {formatInt(m.ld_maletas)}</td>
                      <td className="num px-3 py-2 text-right">{formatBRLFromCents(sd + ld)}</td>
                      <td className="num py-2 pl-3 text-right font-semibold">{formatBRLFromCents(Number(m.sd_vendido_cents) + Number(m.ld_vendido_cents))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Indicadores reais do Financeiro no painel inicial. Zero continua zero. */
function IndicadoresFinanceiros() {
  const q = useQuery({
    queryKey: ["fin-overview", "admin-home"],
    queryFn: () => fetchFinOverviewPeriodo(),
    staleTime: 60_000,
  });
  const d = q.data;
  const linhas: [string, number][] = [
    ["Saldo em contas", d?.saldo_contas_cents ?? 0],
    ["A receber em aberto", d?.a_receber_cents ?? 0],
    ["A pagar em aberto", d?.a_pagar_cents ?? 0],
    ["Vencido a receber", d?.vencido_receber_cents ?? 0],
    ["Vencido a pagar", d?.vencido_pagar_cents ?? 0],
  ];
  return (
    <Panel title="Indicadores financeiros">
      <ul className="space-y-2">
        {linhas.map(([rotulo, valor]) => (
          <li key={rotulo} className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-ledger-muted">{rotulo}</span>
            <span className="num text-sm font-semibold text-ledger-text">
              {q.isLoading ? "—" : formatBRLFromCents(valor)}
            </span>
          </li>
        ))}
      </ul>
      <Link
        to="/admin/financeiro"
        className="mt-4 inline-flex text-sm font-semibold text-bronze underline-offset-4 hover:underline"
      >
        Abrir o Financeiro
      </Link>
    </Panel>
  );
}
