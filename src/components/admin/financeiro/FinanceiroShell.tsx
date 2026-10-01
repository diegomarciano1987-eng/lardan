import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { EmptyState, PageHeader, Panel } from "@/components/admin/ui";
import { useCapabilities, type Capability } from "@/lib/capabilities";
import { PeriodoGlobal } from "@/components/admin/financeiro/PeriodoGlobal";

export interface AreaFinanceira {
  to: string;
  label: string;
  descricao: string;
  capacidade: Capability;
  emImplantacao?: boolean;
  /** alimentado pela API do Asaas: botão azul */
  asaas?: boolean;
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
    to: "/admin/financeiro/pagar-receber",
    label: "Pagar e receber",
    descricao: "Tudo a receber e a pagar, por parcela",
    capacidade: "finance.view",
  },
  {
    to: "/admin/financeiro/contas",
    label: "Contas e extratos",
    descricao: "Saldos pelo razão e extratos",
    capacidade: "finance.bank.view",
  },
  {
    to: "/admin/financeiro/conciliacao",
    label: "Conciliação",
    descricao: "Extratos bancários",
    capacidade: "finance.statement.view",
  },
  {
    to: "/admin/financeiro/dre",
    label: "Relatórios",
    descricao: "DRE e apuração gerencial",
    capacidade: "finance.dre.view",
  },
  {
    to: "/admin/financeiro/fluxo-caixa",
    label: "Fluxo de caixa",
    descricao: "Realizado e previsto",
    capacidade: "finance.dashboard.view",
  },
  {
    to: "/admin/financeiro/aprovacoes",
    label: "Aprovações",
    descricao: "Fila de decisão",
    capacidade: "finance.dashboard.view",
  },
  {
    to: "/admin/financeiro/importacoes",
    label: "Importações",
    descricao: "Títulos a pagar e a receber",
    capacidade: "finance.view",
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
    to: "/admin/financeiro/auditoria",
    label: "Auditoria",
    descricao: "Histórico imutável",
    capacidade: "finance.audit.view",
  },
  {
    to: "/admin/financeiro/configuracoes",
    label: "Configurações",
    descricao: "Parâmetros e integrações",
    capacidade: "finance.view",
  },
  {
    to: "/admin/financeiro/asaas-extrato",
    label: "Extrato Asaas",
    descricao: "Entradas e saídas da conta Asaas",
    capacidade: "finance.statement.view",
    asaas: true,
  },
  {
    to: "/admin/financeiro/asaas",
    label: "Pendências da integração Asaas",
    descricao: "Importação pausada e fila técnica",
    capacidade: "finance.receivable.view",
    asaas: true,
  },
];

/** Destinos principais da faixa; o restante fica no grupo "Mais". */
const PRINCIPAIS = new Set([
  "/admin/financeiro",
  "/admin/financeiro/pagar-receber",
  "/admin/financeiro/contas",
  "/admin/financeiro/conciliacao",
  "/admin/financeiro/dre",
]);

const manterPeriodo = (prev: Record<string, unknown>) => ({
  ...(typeof prev["de"] === "string" ? { de: prev["de"] } : {}),
  ...(typeof prev["ate"] === "string" ? { ate: prev["ate"] } : {}),
});

const PILULA =
  "inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line-soft bg-cream-2 px-4 text-sm font-semibold whitespace-nowrap text-ledger-muted transition-colors hover:text-ledger-text focus-visible:ring-2 focus-visible:ring-champagne focus-visible:outline-none";
const PILULA_ATIVA =
  "inline-flex min-h-10 items-center gap-1.5 rounded-full border border-champagne bg-surface px-4 text-sm font-semibold whitespace-nowrap text-ledger-text shadow-sm focus-visible:ring-2 focus-visible:ring-champagne focus-visible:outline-none";

/** Navegação contextual das áreas do Financeiro, filtrada por capacidade. */
function NavegacaoFinanceira() {
  const caps = useCapabilities();
  const ativa = useAreaFinanceiraAtiva();
  const areas = AREAS_FINANCEIRAS.filter((a) => caps.includes(a.capacidade));
  const [aberto, setAberto] = React.useState(false);
  if (areas.length <= 1) return null;
  const principais = areas.filter((a) => PRINCIPAIS.has(a.to));
  const mais = areas.filter((a) => !PRINCIPAIS.has(a.to));
  const maisAtivo = ativa && !PRINCIPAIS.has(ativa.to);
  return (
    <nav aria-label="Áreas do Financeiro" className="space-y-2">
      <ul className="flex flex-wrap items-center gap-1.5">
        {principais.map((a) => (
          <li key={a.to}>
            <Link
              to={a.to}
              search={manterPeriodo as never}
              activeOptions={{ exact: a.to === "/admin/financeiro" }}
              className={PILULA}
              activeProps={{ className: PILULA_ATIVA, "aria-current": "page" }}
            >
              {a.label}
            </Link>
          </li>
        ))}
        {mais.length ? (
          <li>
            <button
              type="button"
              aria-expanded={aberto}
              onClick={() => setAberto((v) => !v)}
              className={maisAtivo ? PILULA_ATIVA : PILULA}
            >
              {maisAtivo ? `Mais · ${ativa?.label}` : "Mais"} {aberto ? "▴" : "▾"}
            </button>
          </li>
        ) : null}
      </ul>
      {aberto ? (
        <ul className="grid gap-1.5 rounded-[14px] border border-line-soft bg-surface p-2 sm:grid-cols-2 lg:grid-cols-4">
          {mais.map((a) => (
            <li key={a.to}>
              <Link
                to={a.to}
                search={manterPeriodo as never}
                onClick={() => setAberto(false)}
                className={`flex min-h-12 flex-col justify-center rounded-[10px] px-3 py-2 hover:bg-cream-2 focus-visible:ring-2 focus-visible:outline-none ${a.asaas ? "focus-visible:ring-asaas" : "focus-visible:ring-champagne"}`}
              >
                <span className={`text-sm font-semibold ${a.asaas ? "text-asaas" : "text-ledger-text"}`}>{a.label}</span>
                <span className="text-xs text-ledger-muted">{a.descricao}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}

/**
 * Cabeçalho, indicadores e navegação interna compartilhados por todas
 * as páginas financeiras. Fica sempre abaixo do cabeçalho da página e
 * nunca compete com o menu global inferior.
 */
/** Área ativa do Financeiro conforme o endereço da tela. */
function useAreaFinanceiraAtiva(): AreaFinanceira | undefined {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname.startsWith("/admin/financeiro/contas/")) {
    return AREAS_FINANCEIRAS.find((a) => a.to === "/admin/financeiro/contas");
  }
  const exatas = AREAS_FINANCEIRAS.filter((a) => a.to === pathname);
  if (exatas.length > 0) return exatas[0];
  return AREAS_FINANCEIRAS.filter((a) => a.to !== "/admin/financeiro").find((a) =>
    pathname.startsWith(`${a.to}/`),
  );
}

export function FinanceiroShell({ children }: { children: React.ReactNode }) {
  const caps = useCapabilities();
  const area = useAreaFinanceiraAtiva();
  const titulo = area && area.to !== "/admin/financeiro" ? area.label : "Visão geral";

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
      <PageHeader eyebrow="Financeiro" title={titulo} actions={<PeriodoGlobal />} />

      <NavegacaoFinanceira />

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
