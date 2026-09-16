import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState, Panel, Skeleton, formatBRLFromCents } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { usePeriodoFinanceiro } from "@/components/admin/financeiro/PeriodoGlobal";
import {
  fetchClassificacoes,
  fetchFinDre,
  fetchFinDreDetalhe,
  type FiltrosDre,
} from "@/lib/financeiro";

interface Busca {
  de?: string;
  ate?: string;
  regime?: string;
  centro?: string;
  entidade?: string;
}

export const Route = createFileRoute("/_authenticated/admin/financeiro/dre")({
  component: Dre,
  validateSearch: (s: Record<string, unknown>): Busca => ({
    ...(typeof s["de"] === "string" ? { de: s["de"] } : {}),
    ...(typeof s["ate"] === "string" ? { ate: s["ate"] } : {}),
    ...(typeof s["regime"] === "string" ? { regime: s["regime"] } : {}),
    ...(typeof s["centro"] === "string" ? { centro: s["centro"] } : {}),
    ...(typeof s["entidade"] === "string" ? { entidade: s["entidade"] } : {}),
  }),
});

const GRUPOS: { natureza: string; rotulo: string }[] = [
  { natureza: "receita", rotulo: "Receitas" },
  { natureza: "deducao", rotulo: "Deduções" },
  { natureza: "custo", rotulo: "Custos" },
  { natureza: "despesa", rotulo: "Despesas" },
  { natureza: "ativo", rotulo: "Outros — ativo" },
  { natureza: "passivo", rotulo: "Outros — passivo" },
  { natureza: "resultado", rotulo: "Outros — resultado" },
];

function Dre() {
  const navigate = useNavigate();
  const s = Route.useSearch();
  const periodo = usePeriodoFinanceiro();
  const regime: "competencia" | "caixa" = s.regime === "caixa" ? "caixa" : "competencia";
  const centro = s.centro ?? "";
  const entidade = s.entidade ?? "";
  const [aberto, setAberto] = React.useState<
    { chart_id?: string; sem_classificacao?: boolean; rotulo: string } | null
  >(null);

  const filtros: FiltrosDre = {
    de: periodo.de,
    ate: periodo.ate,
    regime,
    ...(centro ? { centro_custo_id: centro } : {}),
    ...(entidade ? { entidade_id: entidade } : {}),
  };

  const classif = useQuery({
    queryKey: ["fin-classificacoes", "dre"],
    queryFn: () => fetchClassificacoes({}),
    staleTime: 60_000,
  });
  const q = useQuery({ queryKey: ["fin-dre", filtros], queryFn: () => fetchFinDre(filtros) });
  const det = useQuery({
    queryKey: ["fin-dre-detalhe", filtros, aberto],
    queryFn: () =>
      fetchFinDreDetalhe({
        ...filtros,
        ...(aberto?.chart_id ? { chart_id: aberto.chart_id } : {}),
        ...(aberto?.sem_classificacao ? { sem_classificacao: true } : {}),
      }),
    enabled: aberto !== null,
  });

  const trocar = (campo: keyof Busca, valor: string) =>
    void navigate({
      to: "/admin/financeiro/dre",
      search: (prev: Busca) => ({ ...prev, [campo]: valor }),
      replace: true,
    });

  const d = q.data;

  return (
    <AreaFinanceiraGuard capacidade="finance.dre.view">
      <div className="space-y-6">
        <Panel title="DRE gerencial">
          <div className="flex flex-wrap items-center gap-3">
            <SmartSelect
              options={[
                { value: "competencia", label: "Regime de competência" },
                { value: "caixa", label: "Regime de caixa" },
              ]}
              value={regime}
              onChange={(v) => trocar("regime", v)}
              className="w-60"
            />
            <SmartSelect
              options={[
                { value: "", label: "Todos os centros de custo" },
                ...(classif.data?.centros ?? []).map((c) => ({
                  value: c.id,
                  label: `${c.codigo} · ${c.nome}`,
                })),
              ]}
              value={centro}
              onChange={(v) => trocar("centro", v)}
              className="w-64"
            />
            <SmartSelect
              options={[
                { value: "", label: "Todas as entidades" },
                ...(classif.data?.entidades ?? []).map((e) => ({ value: e.id, label: e.nome })),
              ]}
              value={entidade}
              onChange={(v) => trocar("entidade", v)}
              className="w-56"
            />
          </div>
          <p className="mt-3 text-xs font-medium text-ledger-muted">
            Apuração gerencial da LARDAN, para uso interno — não é demonstração contábil nem fiscal
            oficial. {d?.fonte}
          </p>
        </Panel>

        {q.isLoading ? <Skeleton className="h-48 w-full" /> : null}
        {q.error ? <ErrorState message="Não foi possível apurar a DRE." /> : null}

        {d ? (
          <>
            <Panel title="Resultado do período" flush>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <tbody>
                    {GRUPOS.map((g) => {
                      const linhas = d.linhas.filter((l) => l.natureza === g.natureza);
                      if (linhas.length === 0) return null;
                      return (
                        <React.Fragment key={g.natureza}>
                          <tr className="border-b border-line-soft bg-cream-2">
                            <td className="px-5 py-2 font-semibold text-ledger-text" colSpan={2}>
                              {g.rotulo}
                            </td>
                          </tr>
                          {linhas.map((l) => (
                            <tr key={l.chart_id} className="border-b border-line-soft/60">
                              <td className="px-5 py-2">
                                <button
                                  type="button"
                                  className="text-left text-ledger-text underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-champagne focus-visible:outline-none"
                                  onClick={() =>
                                    setAberto({
                                      chart_id: l.chart_id,
                                      rotulo: `${l.codigo} · ${l.nome}`,
                                    })
                                  }
                                >
                                  {l.codigo} · {l.nome}
                                </button>
                              </td>
                              <td className="px-5 py-2 text-right tabular-nums">
                                {formatBRLFromCents(l.valor_cents)}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                    {d.linhas.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-5 py-8 text-center text-ledger-muted">
                          Nenhum título classificado no período. Nada é estimado aqui.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Panel>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Total rotulo="Receita bruta" valor={d.totais.receita_bruta_cents} />
              <Total rotulo="Receita líquida" valor={d.totais.receita_liquida_cents} />
              <Total rotulo="Resultado bruto" valor={d.totais.resultado_bruto_cents} />
              <Total rotulo="Resultado do período" valor={d.totais.resultado_cents} />
            </div>

            <Panel title="Pendências de classificação">
              <p className="text-sm font-medium text-ledger-text">
                {d.pendentes_classificacao.quantidade} título(s) sem conta contábil, somando{" "}
                <strong className="tabular-nums">
                  {formatBRLFromCents(d.pendentes_classificacao.valor_cents)}
                </strong>
                . Esses valores ficam fora do resultado acima e nunca são classificados
                automaticamente.
              </p>
              {d.pendentes_classificacao.quantidade > 0 ? (
                <button
                  type="button"
                  className="admin-btn mt-3"
                  onClick={() =>
                    setAberto({ sem_classificacao: true, rotulo: "Títulos sem classificação" })
                  }
                >
                  Ver títulos pendentes
                </button>
              ) : null}
            </Panel>
          </>
        ) : null}

        <Dialog open={aberto !== null} onOpenChange={(v) => !v && setAberto(null)}>
          <DialogContent className="admin-scope max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{aberto?.rotulo ?? ""}</DialogTitle>
              <DialogDescription>
                Origem dos valores, com os mesmos filtros, período e regime da tela.
              </DialogDescription>
            </DialogHeader>
            {det.isLoading ? <Skeleton className="h-32 w-full" /> : null}
            {det.error ? <ErrorState message="Não foi possível abrir a origem." /> : null}
            {det.data ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold tabular-nums text-ledger-text">
                  Soma: {formatBRLFromCents(det.data.soma_cents)} · {det.data.rows.length}{" "}
                  registro(s)
                </p>
                <ul className="divide-y divide-line-soft/60 text-sm">
                  {det.data.rows.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-4 py-2">
                      <span className="text-ledger-text">
                        {new Date(`${r.data}T12:00:00`).toLocaleDateString("pt-BR")} ·{" "}
                        {r.descricao ?? "—"}
                        <span className="text-ledger-muted"> · {r.contraparte}</span>
                      </span>
                      <span className="tabular-nums font-semibold">
                        {formatBRLFromCents(r.valor_cents)}
                      </span>
                    </li>
                  ))}
                  {det.data.rows.length === 0 ? (
                    <li className="py-4 text-center text-ledger-muted">Nenhum registro.</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </AreaFinanceiraGuard>
  );
}

function Total({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="ledger-panel px-5 py-4">
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums text-ledger-text">
        {formatBRLFromCents(valor)}
      </p>
    </div>
  );
}
