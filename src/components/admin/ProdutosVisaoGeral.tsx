import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Barcode,
  Boxes,
  Coins,
  Layers,
  Package,
  PiggyBank,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel, ErrorState, Skeleton, formatBRLFromCents, formatInt } from "@/components/admin/ui";

interface ItemRanking {
  id: string;
  name: string;
  venda: number;
  custo: number;
  margem: number | null;
}

interface ItemEstoque {
  product_id: string;
  produto: string;
  label: string | null;
  sku: string | null;
  quantidade: number;
  valor_venda: number;
}

interface Faixa {
  ordem: number;
  faixa: string;
  pecas: number;
  venda_cents: number;
}

interface Overview {
  totais: Record<string, number>;
  valores: Record<string, number | null>;
  estoque: Record<string, number>;
  top_estoque: ItemEstoque[];
  mais_caros: ItemRanking[];
  mais_baratos: ItemRanking[];
  melhor_margem: ItemRanking[];
  pior_margem: ItemRanking[];
  faixas: Faixa[];
  alertas: Record<string, number>;
}

const pct = (v: number | null | undefined) =>
  v == null ? "—" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v)}%`;

function Kpi({
  icon,
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "success" | "warning" | "danger";
  onClick?: () => void;
}) {
  const cor =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-ledger-text";
  const conteudo = (
    <>
      <div className="flex items-center gap-2 text-ledger-muted">
        <span aria-hidden className="opacity-70">
          {icon}
        </span>
        <span className="ledger-eyebrow">{label}</span>
      </div>
      <p className={`num text-[1.6rem] leading-tight font-semibold ${cor}`}>{value}</p>
      {hint && <p className="text-[0.8125rem] font-medium text-ledger-muted">{hint}</p>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="ledger-panel flex min-w-0 cursor-pointer flex-col gap-2 px-5 py-4 text-left transition hover:border-champagne hover:shadow-sm"
      >
        {conteudo}
      </button>
    );
  }
  return <div className="ledger-panel flex min-w-0 flex-col gap-2 px-5 py-4">{conteudo}</div>;
}

function ListaRanking({
  titulo,
  itens,
  metrica,
  onClick,
}: {
  titulo: string;
  itens: ItemRanking[];
  metrica: (i: ItemRanking) => string;
  onClick: (id: string) => void;
}) {
  return (
    <Panel title={titulo}>
      {itens.length === 0 ? (
        <p className="text-sm text-ledger-muted">Sem dados.</p>
      ) : (
        <ol className="space-y-1">
          {itens.map((i, idx) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => onClick(i.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-line-soft/60"
              >
                <span className="num w-5 shrink-0 text-[0.75rem] text-ledger-muted">{idx + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ledger-text">{i.name}</span>
                <span className="num shrink-0 text-[0.875rem] font-semibold text-ledger-text">
                  {metrica(i)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function ProdutosVisaoGeral() {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["catalog-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("catalog_overview");
      if (error) throw error;
      return data as unknown as Overview;
    },
  });

  const abrir = (id: string) =>
    void navigate({ to: "/admin/cadastros/produtos/$id", params: { id } });

  if (q.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  if (q.error || !q.data) {
    return (
      <ErrorState
        message={q.error instanceof Error ? q.error.message : "Não foi possível carregar a visão geral."}
        onRetry={() => void q.refetch()}
      />
    );
  }

  const d = q.data;
  const t = d.totais;
  const v = d.valores;
  const e = d.estoque;
  const a = d.alertas;
  const maiorFaixa = Math.max(1, ...d.faixas.map((f) => f.pecas));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={<Package className="size-4" />}
          label="Peças cadastradas"
          value={formatInt(t['produtos'] ?? 0)}
          hint={`${formatInt(t['publicados'] ?? 0)} publicadas · ${formatInt(t['rascunhos'] ?? 0)} em rascunho`}
        />
        <Kpi
          icon={<Coins className="size-4" />}
          label="Custo total do catálogo"
          value={formatBRLFromCents(v['custo_total_cents'] ?? 0)}
          hint={`Custo médio ${formatBRLFromCents(v['custo_medio_cents'] ?? 0)}`}
        />
        <Kpi
          icon={<PiggyBank className="size-4" />}
          label="Valor nas ruas (venda)"
          value={formatBRLFromCents(v['venda_total_cents'] ?? 0)}
          hint={`Preço médio ${formatBRLFromCents(v['venda_media_cents'] ?? 0)}`}
        />
        <Kpi
          icon={<TrendingUp className="size-4" />}
          label="Lucro potencial"
          value={formatBRLFromCents(v['lucro_potencial_cents'] ?? 0)}
          tone="success"
          hint={`Markup médio ${pct(v['markup_medio'])} · mediana ${pct(v['markup_mediano'])}`}
        />
        <Kpi
          icon={<Layers className="size-4" />}
          label="Variantes vendáveis"
          value={formatInt(t['variantes'] ?? 0)}
          hint={`${formatInt(t['categorias'] ?? 0)} categorias`}
        />
        <Kpi
          icon={<Barcode className="size-4" />}
          label="Com código de barras"
          value={formatInt(t['com_barcode'] ?? 0)}
          tone={(t['sem_barcode'] ?? 0) > 0 ? "warning" : "success"}
          hint={`${formatInt(t['sem_barcode'] ?? 0)} ainda sem código`}
        />
        <Kpi
          icon={<Boxes className="size-4" />}
          label="Peças em estoque"
          value={formatInt(e['pecas'] ?? 0)}
          hint={`${formatInt(e['itens'] ?? 0)} itens com saldo · ${formatBRLFromCents(e['valor_venda_cents'] ?? 0)} em venda`}
        />
        <Kpi
          icon={<AlertTriangle className="size-4" />}
          label="Cadastros a corrigir"
          value={formatInt(
            (t['sem_custo'] ?? 0) + (t['sem_preco'] ?? 0) + (t['sem_ncm'] ?? 0) + (t['sem_referencia'] ?? 0),
          )}
          tone="warning"
          hint={`${formatInt(t['sem_custo'] ?? 0)} sem custo · ${formatInt(t['sem_preco'] ?? 0)} sem preço · ${formatInt(t['sem_ncm'] ?? 0)} sem NCM · ${formatInt(t['sem_referencia'] ?? 0)} sem referência`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top 10 — mais peças em estoque">
          {d.top_estoque.length === 0 ? (
            <p className="text-sm text-ledger-muted">
              Nenhum saldo lançado ainda. Ao contar o estoque pelo leitor, esta lista se preenche.
            </p>
          ) : (
            <ol className="space-y-1">
              {d.top_estoque.map((i, idx) => (
                <li key={`${i.product_id}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => abrir(i.product_id)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-line-soft/60"
                  >
                    <span className="num w-5 shrink-0 text-[0.75rem] text-ledger-muted">{idx + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ledger-text">
                      {i.produto}
                      {i.sku ? <span className="num text-ledger-muted"> · {i.sku}</span> : null}
                    </span>
                    <span className="num shrink-0 text-[0.875rem] text-ledger-muted">
                      {formatBRLFromCents(i.valor_venda)}
                    </span>
                    <span className="num w-14 shrink-0 text-right text-[0.875rem] font-semibold text-ledger-text">
                      {formatInt(i.quantidade)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title="Distribuição por faixa de preço">
          <div className="space-y-3">
            {d.faixas.map((f) => (
              <div key={f.ordem} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
                  <span className="text-ledger-text">{f.faixa}</span>
                  <span className="num text-ledger-muted">
                    {formatInt(f.pecas)} peças · {formatBRLFromCents(f.venda_cents)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-line-soft">
                  <div
                    className="h-full rounded-full bg-champagne"
                    style={{ width: `${Math.max(2, (f.pecas / maiorFaixa) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ListaRanking
          titulo="Top 10 — melhor margem"
          itens={d.melhor_margem}
          metrica={(i) => pct(i.margem)}
          onClick={abrir}
        />
        <ListaRanking
          titulo="Top 5 — peças mais caras"
          itens={d.mais_caros}
          metrica={(i) => formatBRLFromCents(i.venda)}
          onClick={abrir}
        />
        <ListaRanking
          titulo="Top 5 — peças mais baratas"
          itens={d.mais_baratos}
          metrica={(i) => formatBRLFromCents(i.venda)}
          onClick={abrir}
        />
        <ListaRanking
          titulo="Atenção — pior margem"
          itens={d.pior_margem}
          metrica={(i) => pct(i.margem)}
          onClick={abrir}
        />
        <Panel title="Saúde do cadastro">
          <ul className="space-y-2 text-[0.875rem]">
            <li className="flex items-center justify-between gap-3">
              <span className="text-ledger-muted">Peças vendidas abaixo do custo</span>
              <span
                className={`num font-semibold ${(a['margem_negativa'] ?? 0) > 0 ? "text-danger" : "text-ledger-text"}`}
              >
                {formatInt(a['margem_negativa'] ?? 0)}
              </span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-ledger-muted">Códigos de referência repetidos</span>
              <span className="num font-semibold text-ledger-text">
                {formatInt(a['referencias_repetidas'] ?? 0)}
              </span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-ledger-muted">Publicadas sem preço</span>
              <span
                className={`num font-semibold ${(a['publicados_sem_preco'] ?? 0) > 0 ? "text-warning" : "text-ledger-text"}`}
              >
                {formatInt(a['publicados_sem_preco'] ?? 0)}
              </span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-ledger-muted">Variantes sem saldo em estoque</span>
              <span className="num font-semibold text-ledger-text">{formatInt(e['sem_saldo'] ?? 0)}</span>
            </li>
          </ul>
        </Panel>
        <Panel title="Estoque avaliado">
          <ul className="space-y-2 text-[0.875rem]">
            <li className="flex items-center justify-between gap-3">
              <span className="text-ledger-muted">Peças contadas</span>
              <span className="num font-semibold text-ledger-text">{formatInt(e['pecas'] ?? 0)}</span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-ledger-muted">Valor em custo</span>
              <span className="num font-semibold text-ledger-text">
                {formatBRLFromCents(e['valor_custo_cents'] ?? 0)}
              </span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-ledger-muted">Valor em venda</span>
              <span className="num font-semibold text-ledger-text">
                {formatBRLFromCents(e['valor_venda_cents'] ?? 0)}
              </span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-ledger-muted">Margem potencial do estoque</span>
              <span className="num font-semibold text-success">
                {formatBRLFromCents((e['valor_venda_cents'] ?? 0) - (e['valor_custo_cents'] ?? 0))}
              </span>
            </li>
          </ul>
          <p className="mt-3 flex items-center gap-2 text-[0.8125rem] text-ledger-muted">
            <TrendingDown aria-hidden className="size-3.5" />
            Enquanto a contagem não acontece, o valor nas ruas considera o catálogo inteiro.
          </p>
        </Panel>
      </div>
    </div>
  );
}
