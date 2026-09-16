import * as React from "react";
import { useQuery } from "@tanstack/react-query";
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
    descricao: "Em implantação",
    capacidade: "finance.view",
    emImplantacao: true,
  },
  {
    to: "/admin/financeiro/dre",
    label: "DRE e relatórios",
    descricao: "Em implantação",
    capacidade: "finance.dre.view",
    emImplantacao: true,
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
  const q = useQuery({
    queryKey: ["fin-overview", "shell"],
    queryFn: () => fetchFinOverviewPeriodo(),
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
