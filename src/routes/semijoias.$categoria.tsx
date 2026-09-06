import { useCallback, useMemo } from "react";
import { createFileRoute, Link, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/site/SiteLayout";
import { CategoryHero } from "@/components/site/categoria/CategoryHero";
import { PieceCard, PieceSkeleton } from "@/components/site/categoria/PieceCard";
import {
  CategoryFilters,
  FILTROS_VAZIOS,
  contarFiltrosAtivos,
  type FiltrosCategoria,
} from "@/components/site/categoria/CategoryFilters";
import { personalidade } from "@/components/site/categoria/personalidade";
import {
  browsePublicProducts,
  getPublicCategory,
  mediaUrl,
  type CategoriaDetalhe,
  type OrdemVitrine,
  type PecaVitrine,
} from "@/lib/storefront";

const POR_PAGINA = 12;
const ORDENS_VALIDAS: OrdemVitrine[] = ["curadoria", "lancamentos", "nome", "preco_asc", "preco_desc"];

interface BuscaCategoria extends FiltrosCategoria {}

function texto(v: unknown) {
  return typeof v === "string" ? v : "";
}
function numero(v: unknown) {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}
function booleano(v: unknown) {
  return v === true || v === "true" || v === "1";
}

export const Route = createFileRoute("/semijoias/$categoria")({
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput): BuscaCategoria => {
    const ordem = texto(search["ordem"]) as OrdemVitrine;
    return {
      q: texto(search["q"]).slice(0, 120),
      colecao: texto(search["colecao"]),
      material: texto(search["material"]),
      banho: texto(search["banho"]),
      preco_min: numero(search["preco_min"]),
      preco_max: numero(search["preco_max"]),
      disponivel: booleano(search["disponivel"]),
      lancamentos: booleano(search["lancamentos"]),
      destaques: booleano(search["destaques"]),
      ordem: ORDENS_VALIDAS.includes(ordem) ? ordem : "curadoria",
    };
  },
  loader: async ({ params }) => {
    try {
      return { categoria: await getPublicCategory(params.categoria) };
    } catch {
      return { categoria: null };
    }
  },
  head: ({ params, loaderData }) => {
    const c = loaderData?.categoria ?? null;
    const canonical = `/semijoias/${params.categoria}`;
    if (!c) {
      return {
        meta: [
          { title: "Categoria indisponível — LARDAN" },
          { name: "robots", content: "noindex" },
        ],
        links: [{ rel: "canonical", href: canonical }],
      };
    }
    const titulo = c.seo_title?.trim() || `${c.name} — Semijoias LARDAN`;
    const descricao =
      c.seo_description?.trim() ||
      c.description?.trim() ||
      `Peças de ${c.name.toLowerCase()} da curadoria Lardan, publicadas no catálogo oficial.`;
    const imagem = mediaUrl(c.hero_media_id) ?? mediaUrl(c.fallback_media_id);
    const absoluta = imagem && /^https?:\/\//.test(imagem) ? imagem : null;

    return {
      meta: [
        { title: titulo },
        { name: "description", content: descricao },
        { property: "og:title", content: titulo },
        { property: "og:description", content: descricao },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonical },
        { name: "twitter:card", content: "summary_large_image" },
        ...(absoluta
          ? [
              { property: "og:image", content: absoluta },
              { name: "twitter:image", content: absoluta },
            ]
          : []),
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: CategoriaPage,
  errorComponent: () => (
    <SiteLayout>
      <AvisoEditorial
        titulo="Não conseguimos abrir esta categoria"
        texto="Tente novamente em instantes — as peças continuam publicadas."
      />
    </SiteLayout>
  ),
  notFoundComponent: () => (
    <SiteLayout>
      <AvisoEditorial
        titulo="Categoria não encontrada"
        texto="Talvez ela tenha saído do ar. Conheça as demais semijoias da casa."
      />
    </SiteLayout>
  ),
});

function AvisoEditorial({ titulo, texto: t }: { titulo: string; texto: string }) {
  return (
    <section className="mx-auto max-w-3xl px-6 py-40 text-center">
      <h1 className="font-display text-4xl text-foreground md:text-5xl">{titulo}</h1>
      <p className="mt-6 text-base leading-relaxed text-muted-foreground">{t}</p>
      <div className="mt-10 flex justify-center">
        <Link to="/semijoias" className="btn-premium">
          Ver todas as semijoias
        </Link>
      </div>
    </section>
  );
}

function CategoriaPage() {
  const { categoria: slug } = Route.useParams();
  const busca = Route.useSearch();
  const navigate = useNavigate({ from: "/semijoias/$categoria" });
  const p = personalidade(slug);

  const detalhe = useQuery({
    queryKey: ["categoria-publica", slug],
    queryFn: () => getPublicCategory(slug),
  });

  const listagem = useInfiniteQuery({
    queryKey: ["vitrine-categoria", slug, busca],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      browsePublicProducts({
        categoria: slug,
        colecao: busca.colecao || null,
        busca: busca.q.trim() || null,
        material: busca.material || null,
        banho: busca.banho || null,
        destaque: busca.destaques ? true : null,
        lancamento: busca.lancamentos ? true : null,
        disponivel: busca.disponivel ? true : null,
        precoMin: busca.preco_min,
        precoMax: busca.preco_max,
        ordem: busca.ordem,
        pagina: pageParam as number,
        porPagina: POR_PAGINA,
      }),
    getNextPageParam: (ultima, paginas) =>
      paginas.flatMap((x) => x.rows).length < ultima.total ? paginas.length : undefined,
  });

  const pecas: PecaVitrine[] = useMemo(
    () => listagem.data?.pages.flatMap((x) => x.rows) ?? [],
    [listagem.data],
  );
  const total = listagem.data?.pages[0]?.total ?? 0;

  const aplicar = useCallback(
    (parcial: Partial<FiltrosCategoria>) => {
      void navigate({
        search: (prev) => ({ ...prev, ...parcial }),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );

  const limpar = useCallback(() => {
    void navigate({ search: () => ({ ...FILTROS_VAZIOS }), replace: true, resetScroll: false });
  }, [navigate]);

  const contexto = useMemo(() => ({ de: `/semijoias/${slug}`, busca }), [slug, busca]);
  const cat = detalhe.data;
  const ativos = contarFiltrosAtivos(busca);

  return (
    <SiteLayout>
      {cat ? (
        <CategoryHero categoria={cat} />
      ) : (
        <div className="mx-auto max-w-[88rem] px-6 pb-16 pt-40">
          <div className="h-16 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      )}

      {cat ? (
        <CategoryFilters
          categoria={cat}
          filtros={busca}
          aplicar={aplicar}
          limpar={limpar}
          encontrados={total}
        />
      ) : null}

      <main className="mx-auto max-w-[88rem] px-6 pb-32">
        {listagem.isLoading ? (
          <div className="grid gap-14 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <PieceSkeleton key={i} proporcao={p.proporcao} moldura={p.moldura} />
            ))}
          </div>
        ) : listagem.error ? (
          <p className="py-24 text-center text-base text-muted-foreground">
            Não conseguimos carregar as peças agora. Tente novamente em instantes.
          </p>
        ) : pecas.length === 0 ? (
          <div className="py-24 text-center">
            <p className="font-display text-3xl text-foreground">
              {ativos ? "Nenhuma peça com esses critérios" : "Coleção em preparação"}
            </p>
            <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
              {ativos
                ? "Ajuste ou limpe os filtros para ver toda a curadoria desta categoria."
                : "As próximas peças desta categoria estão sendo fotografadas com calma."}
            </p>
            {ativos ? (
              <button type="button" className="btn-premium mt-10" onClick={limpar}>
                Limpar filtros
              </button>
            ) : null}
          </div>
        ) : (
          <Composicao pecas={pecas} personalidade={p} contexto={contexto} nota={p.nota} />
        )}

        {listagem.isFetchingNextPage ? (
          <div className="mt-16 grid gap-14 md:grid-cols-2">
            {[0, 1].map((i) => (
              <PieceSkeleton key={i} proporcao={p.proporcao} moldura={p.moldura} />
            ))}
          </div>
        ) : null}

        {pecas.length > 0 ? (
          <div className="mt-24 flex flex-col items-center gap-4">
            {listagem.hasNextPage ? (
              <button
                type="button"
                className="btn-premium"
                onClick={() => void listagem.fetchNextPage()}
                disabled={listagem.isFetchingNextPage}
              >
                Ver mais peças
              </button>
            ) : (
              <p className="text-[0.7rem] uppercase tracking-[0.3em] text-muted-foreground">
                Você viu toda a curadoria desta categoria
              </p>
            )}
          </div>
        ) : null}
      </main>

      {cat && pecas.length ? <DadosEstruturados categoria={cat} pecas={pecas} /> : null}
    </SiteLayout>
  );
}

/** Ritmo editorial: abertura ampla, pares, peça ampla, trio — sem grade repetitiva. */
function Composicao({
  pecas,
  personalidade: p,
  contexto,
  nota,
}: {
  pecas: PecaVitrine[];
  personalidade: ReturnType<typeof personalidade>;
  contexto: Record<string, unknown>;
  nota: string;
}) {
  const blocos: { tipo: "abertura" | "par" | "ampla" | "trio"; itens: PecaVitrine[] }[] = [];
  let i = 0;
  const ciclo: ("par" | "ampla" | "trio")[] = ["par", "ampla", "trio", "par"];
  let c = 0;
  if (pecas.length) {
    blocos.push({ tipo: "abertura", itens: [pecas[0]!] });
    i = 1;
  }
  while (i < pecas.length) {
    const tipo = ciclo[c % ciclo.length]!;
    const n = tipo === "par" ? 2 : tipo === "trio" ? 3 : 1;
    blocos.push({ tipo, itens: pecas.slice(i, i + n) });
    i += n;
    c++;
  }

  return (
    <div className="space-y-24 md:space-y-32">
      {blocos.map((b, idx) => {
        const chave = b.itens.map((x) => x.id).join("-") || idx;
        if (b.tipo === "abertura") {
          return (
            <div key={chave} className="md:max-w-[72%]">
              <PieceCard
                peca={b.itens[0]!}
                escala="abertura"
                proporcao={p.proporcao}
                proporcaoDestaque={p.proporcaoDestaque}
                moldura={p.moldura}
                prioridade
                contexto={contexto}
              />
            </div>
          );
        }
        if (b.tipo === "ampla") {
          return (
            <div key={chave} className="flex md:justify-end">
              <div className="w-full md:w-[64%]">
                <PieceCard
                  peca={b.itens[0]!}
                  escala="ampla"
                  proporcao={p.proporcao}
                  proporcaoDestaque={p.proporcaoDestaque}
                  moldura={p.moldura}
                  contexto={contexto}
                />
              </div>
            </div>
          );
        }
        if (b.tipo === "trio") {
          return (
            <div key={chave}>
              <p className="brand-eyebrow mb-10">{nota}</p>
              <div className="grid gap-14 md:grid-cols-3 md:gap-10">
                {b.itens.map((peca) => (
                  <PieceCard
                    key={peca.id}
                    peca={peca}
                    escala="discreta"
                    proporcao={p.proporcao}
                    proporcaoDestaque={p.proporcaoDestaque}
                    moldura={p.moldura}
                    contexto={contexto}
                  />
                ))}
              </div>
            </div>
          );
        }
        return (
          <div key={chave} className="grid gap-14 md:grid-cols-2 md:gap-16">
            {b.itens.map((peca, k) => (
              <div key={peca.id} className={k === 1 ? "md:pt-24" : undefined}>
                <PieceCard
                  peca={peca}
                  proporcao={p.proporcao}
                  proporcaoDestaque={p.proporcaoDestaque}
                  moldura={p.moldura}
                  contexto={contexto}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function DadosEstruturados({
  categoria,
  pecas,
}: {
  categoria: CategoriaDetalhe;
  pecas: PecaVitrine[];
}) {
  const dados = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: categoria.name,
        description: categoria.seo_description || categoria.description || undefined,
        url: `/semijoias/${categoria.slug}`,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Lardan", item: "/" },
          { "@type": "ListItem", position: 2, name: "Semijoias", item: "/semijoias" },
          {
            "@type": "ListItem",
            position: 3,
            name: categoria.name,
            item: `/semijoias/${categoria.slug}`,
          },
        ],
      },
      {
        "@type": "ItemList",
        numberOfItems: pecas.length,
        itemListElement: pecas.map((peca, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: peca.name,
          url: `/produto/${peca.slug}`,
        })),
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(dados) }}
    />
  );
}
