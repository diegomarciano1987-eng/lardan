import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { EmptyState, PageHeader, Panel, formatBRLFromCents } from "@/components/admin/ui";
import { useCapabilities, type Capability } from "@/lib/capabilities";
import { fetchFinOverviewPeriodo } from "@/lib/financeiro";
import { PeriodoGlobal, usePeriodoFinanceiro } from "@/components/admin/financeiro/PeriodoGlobal";

export interface AreaFinanceira {
  to: string;
  label: string;
  descricao: string;
  capacidade: Capability;
  emImplantacao?: boolean;
}

/** Segunda camada de navegação do departamento financeiro. */
export const AREAS_FINANCEIRAS: AreaFinanceira[] = [
  {
    to: "/admin/financeiro",
    label: "Visão geral",
    descricao: "Painel do departamento",
    capacidade: "finance.dashboard.view",
  },
  {
    to: "/admin/financeiro/pagar",
    label: "Contas a pagar",
    descricao: "Títulos a pagar",
    capacidade: "finance.payable.view",
  },
  {
    to: "/admin/financeiro/receber",
    label: "Contas a receber",
    descricao: "Títulos a receber",
    capacidade: "finance.receivable.view",
  },
  {
    to: "/admin/financeiro/fluxo-caixa",
    label: "Fluxo de caixa",
    descricao: "Realizado e previsto",
    capacidade: "finance.dashboard.view",
  },
  {
    to: "/admin/financeiro/contas",
    label: "Contas e caixas",
    descricao: "Saldos pelo razão",
    capacidade: "finance.bank.view",
  },
  {
    to: "/admin/financeiro/asaas",
    label: "Recebíveis Asaas",
    descricao: "Importação, cobrança e conciliação (simulação)",
    capacidade: "finance.receivable.view",
    emImplantacao: true,
  },
  {
    to: "/admin/financeiro/conciliacao",
    label: "Conciliação",
    descricao: "Extratos bancários",
    capacidade: "finance.statement.view",
  },
  {
    to: "/admin/financeiro/plano-contas",
    label: "Plano de contas",
    descricao: "Classificação contábil",
    capacidade: "finance.view",
  },
  {
    to: "/admin/financeiro/centros-custo",
    label: "Centros de custo",
    descricao: "Estrutura de custos",
    capacidade: "finance.view",
  },
  {
    to: "/admin/financeiro/aprovacoes",
    label: "Aprovações",
    descricao: "Fila de decisão",
    capacidade: "finance.dashboard.view",
  },
  {
    to: "/admin/financeiro/auditoria",
    label: "Auditoria",
    descricao: "Histórico imutável",
    capacidade: "finance.audit.view",
  },
  {
    to: "/admin/financeiro/importacoes",
    label: "Importações",
    descricao: "Títulos a pagar e a receber",
    capacidade: "finance.view",
  },
  {
    to: "/admin/financeiro/dre",
    label: "DRE e relatórios",
    descricao: "Apuração gerencial",
    capacidade: "finance.dre.view",
  },
  {
    to: "/admin/financeiro/configuracoes",
    label: "Configurações",
    descricao: "Parâmetros e integrações",
    capacidade: "finance.view",
  },
];

function Indicador({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-[12px] border border-line-soft bg-cream-2 px-4 py-3">
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className="mt-1 font-display text-lg font-bold tabular-nums text-ledger-text">{valor}</p>
      {nota ? <p className="mt-0.5 text-xs font-medium text-ledger-muted">{nota}</p> : null}
    </div>
  );
}

function ResumoFinanceiro() {
  const { de, ate } = usePeriodoFinanceiro();
  const q = useQuery({
    queryKey: ["fin-overview", "shell", de, ate],
    queryFn: () => fetchFinOverviewPeriodo(de, ate),
    staleTime: 60_000,
  });
  const d = q.data;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Indicador
        rotulo="Saldo em contas"
        valor={d ? formatBRLFromCents(d.saldo_contas_cents) : "—"}
        nota="Calculado pelo razão"
      />
      <Indicador
        rotulo="A receber em aberto"
        valor={d ? formatBRLFromCents(d.a_receber_cents) : "—"}
        nota="Entradas previstas"
      />
      <Indicador
        rotulo="A pagar em aberto"
        valor={d ? formatBRLFromCents(d.a_pagar_cents) : "—"}
        nota="Saídas previstas"
      />
      <Indicador
        rotulo="Aguardando aprovação"
        valor={d ? String(d.titulos_pendentes_aprovacao) : "—"}
        nota="Títulos submetidos"
      />
    </div>
  );
}

/** Navegação contextual das áreas do Financeiro, filtrada por capacidade. */
function NavegacaoFinanceira() {
  const caps = useCapabilities();
  const areas = AREAS_FINANCEIRAS.filter((a) => caps.includes(a.capacidade));
  if (areas.length <= 1) return null;
  return (
    <nav aria-label="Áreas do Financeiro" className="-mx-1 overflow-x-auto pb-1">
      <ul className="flex min-w-max items-center gap-1.5 px-1">
        {areas.map((a) => (
          <li key={a.to}>
            <Link
              to={a.to}
              search={(prev: Record<string, unknown>) => ({
                ...(typeof prev["de"] === "string" ? { de: prev["de"] } : {}),
                ...(typeof prev["ate"] === "string" ? { ate: prev["ate"] } : {}),
              })}
              activeOptions={{ exact: a.to === "/admin/financeiro" }}
              className="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-cream-2 px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap text-ledger-muted transition-colors hover:text-ledger-text focus-visible:ring-2 focus-visible:ring-champagne focus-visible:outline-none"
              activeProps={{
                className:
                  "inline-flex items-center gap-1.5 rounded-full border border-champagne bg-surface px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap text-ledger-text shadow-sm focus-visible:ring-2 focus-visible:ring-champagne focus-visible:outline-none",
                "aria-current": "page",
              }}
            >
              {a.label}
              {a.emImplantacao ? (
                <span className="rounded-full bg-line-soft px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wide text-ledger-muted uppercase">
                  em implantação
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Cabeçalho, indicadores e navegação interna compartilhados por todas
 * as páginas financeiras. Fica sempre abaixo do cabeçalho da página e
 * nunca compete com o menu global inferior.
 */
export function FinanceiroShell({ children }: { children: React.ReactNode }) {
  const caps = useCapabilities();

  if (!caps.includes("finance.view") && !caps.includes("finance.dashboard.view")) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Lardan Cloud" title="Financeiro" />
        <Panel>
          <EmptyState
            title="Acesso não liberado"
            description="Seu perfil não tem permissão para ver dados financeiros."
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      <PageHeader eyebrow="Lardan Cloud" title="Financeiro" actions={<PeriodoGlobal />} />

      <NavegacaoFinanceira />

      <ResumoFinanceiro />

      {children}
    </div>
  );
}

/** Página financeira com guarda de capacidade. */
export function AreaFinanceiraGuard({
  capacidade,
  children,
}: {
  capacidade: Capability;
  children: React.ReactNode;
}) {
  const caps = useCapabilities();
  if (!caps.includes(capacidade)) {
    return (
      <Panel>
        <EmptyState
          title="Acesso não liberado"
          description="Seu perfil não tem permissão para esta área do Financeiro."
        />
      </Panel>
    );
  }
  return <>{children}</>;
}

/** Área que existe na navegação, mas ainda não opera. */
export function EmImplantacao({
  titulo,
  falta,
  proximoPasso,
}: {
  titulo: string;
  falta: string[];
  proximoPasso: string;
}) {
  return (
    <Panel title={titulo}>
      <div className="space-y-4">
        <p className="text-sm font-medium text-ledger-muted">
          Esta área está em implantação. Nada aqui importa, calcula ou exporta ainda — e nenhum
          botão finge fazer isso.
        </p>
        <div>
          <p className="ledger-eyebrow">O que ainda falta</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm font-medium text-ledger-text">
            {falta.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="ledger-eyebrow">Próximo passo técnico</p>
          <p className="mt-1 text-sm font-medium text-ledger-text">{proximoPasso}</p>
        </div>
      </div>
    </Panel>
  );
}
