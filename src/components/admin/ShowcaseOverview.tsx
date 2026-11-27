import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Home } from "lucide-react";
import { EmptyState, Panel, StatusBadge, formatInt } from "@/components/admin/ui";
import { fetchShowcaseCounts, listTaxonomia, type ShowcaseCounts } from "@/lib/showcase";

/** Números vindos do banco + atalhos para ver o site como o público vê. */
export function ShowcaseOverview({
  onIrParaProdutos,
  onIrParaCategorias,
}: {
  onIrParaProdutos: () => void;
  onIrParaCategorias: () => void;
}) {
  const contadores = useQuery({ queryKey: ["vitrine", "contadores"], queryFn: fetchShowcaseCounts });
  const categorias = useQuery({
    queryKey: ["vitrine", "taxonomia", "categories"],
    queryFn: () => listTaxonomia("categories"),
  });

  const cats = categorias.data ?? [];
  const publicadas = cats.filter((c) => c.status === "publicado");

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Cartao
          rotulo="Produtos publicados"
          valor={contadores.data?.publicados}
          descricao="Peças visíveis no site agora"
          onClick={onIrParaProdutos}
        />
        <Cartao
          rotulo="Categorias publicadas"
          valor={publicadas.length}
          descricao={`de ${formatInt(cats.length)} cadastradas`}
          onClick={onIrParaCategorias}
        />
        <Cartao
          rotulo="Produtos com pendências"
          valor={contadores.data?.incompletos}
          descricao="Falta algo para poder publicar"
          onClick={onIrParaProdutos}
        />
        <Cartao
          rotulo="Aguardando publicação"
          valor={contadores.data?.aguardando}
          descricao="Prontos ou em preparação"
          onClick={onIrParaProdutos}
        />
      </section>

      <PendenciasMaisComuns c={contadores.data} />

      <Panel title="Ver como o público vê">
        <div className="flex flex-wrap gap-3">
          <a href="/" target="_blank" rel="noreferrer" className="admin-btn-primary">
            <Home aria-hidden className="size-4" /> Abrir site
          </a>
          <a href="/" target="_blank" rel="noreferrer" className="admin-btn">
            <ExternalLink aria-hidden className="size-4" /> Visualizar página inicial
          </a>
          {publicadas.map((c) => (
            <a
              key={c.id}
              href={`/semijoias/${c.slug}`}
              target="_blank"
              rel="noreferrer"
              className="admin-btn"
            >
              <ExternalLink aria-hidden className="size-4" /> Ver {c.name.toLowerCase()}
            </a>
          ))}
        </div>
      </Panel>

      <Panel title="Situação das categorias">
        {cats.length === 0 ? (
          <EmptyState title="Nenhuma categoria" description="Cadastre categorias para organizar o site." />
        ) : (
          <ul className="space-y-3">
            {cats.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ledger-text">{c.name}</p>
                  <p className="truncate text-xs text-ledger-muted">/semijoias/{c.slug}</p>
                </div>
                <StatusBadge tone={c.status === "publicado" ? "success" : "neutral"}>
                  {c.status === "publicado" ? "No ar" : "Fora do ar"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Cartao({
  rotulo,
  valor,
  descricao,
  onClick,
}: {
  rotulo: string;
  valor: number | undefined;
  descricao: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="ledger-panel px-5 py-4 text-left transition hover:border-champagne">
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums text-ledger-text">
        {valor === undefined ? "—" : formatInt(valor)}
      </p>
      <p className="mt-1 text-xs text-ledger-muted">{descricao}</p>
    </button>
  );
}

/** 0408: o que mais trava a publicação, do maior para o menor. Um produto pode ter mais de uma pendência. */
function PendenciasMaisComuns({ c }: { c: ShowcaseCounts | undefined }) {
  if (!c) return null;
  const itens = ([
    ["Sem descrição", c.sem_descricao],
    ["Sem foto", c.sem_imagem],
    ["Sem categoria", c.sem_categoria],
    ["Sem preço", c.sem_preco],
    ["Sem estoque (não aparece para compra)", c.sem_estoque],
  ] as [string, number | undefined][]).filter((x): x is [string, number] => typeof x[1] === "number").sort((a, b) => b[1] - a[1]);
  const total = Math.max(c.total, 1);
  return (
    <Panel title="Pendências mais comuns">
      <p className="mb-3 text-sm text-ledger-muted">
        Para publicar, o produto precisa de foto, categoria e descrição. Um mesmo produto pode aparecer em mais de uma linha.
      </p>
      <ul className="space-y-2.5">
        {itens.map(([rotulo, n]) => (
          <li key={rotulo} className="text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-ledger-text">{rotulo}</span>
              <span className="num font-semibold text-ledger-text">{formatInt(n)} <span className="font-normal text-ledger-muted">de {formatInt(c.total)}</span></span>
            </div>
            <div className="mt-1 h-1.5 rounded bg-surface-muted"><div className="h-1.5 rounded bg-bronze" style={{ width: `${(n / total) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
