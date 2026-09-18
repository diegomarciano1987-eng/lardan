import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatusBadge } from "@/components/admin/ui";
import { ProdutosVisaoGeral } from "@/components/admin/ProdutosVisaoGeral";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { SmartSelect } from "@/components/premium/SmartSelect";
import {
  listPaged,
  centavosParaTexto,
  STATUS_OPTIONS,
} from "@/lib/catalog";

export const Route = createFileRoute("/_authenticated/admin/cadastros/produtos")({
  component: ProdutosPage,
  head: () => ({
    meta: [
      { title: "Produtos — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

interface ProdutoLinha {
  id: string;
  slug: string;
  name: string;
  legacy_code: string | null;
  status: string;
  price_cents: number | null;
  price_is_public: boolean;
  category_id: string | null;
  collection_id: string | null;
}

const PAGE_SIZE = 20;

const tone = (status: string) =>
  status === "publicado" ? "success" : status === "arquivado" ? "neutral" : "warning";

function ProdutosPage() {
  const navigate = useNavigate();
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [status, setStatus] = useState("todos");
  const [categoria, setCategoria] = useState("todos");
  const [aba, setAba] = useState<"visao" | "lista">("visao");

  // Vindo de "Novo cadastro": abre direto a ficha completa do novo produto.
  const buscaUrl = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  useEffect(() => {
    if (buscaUrl?.['novo']) void navigate({ to: "/admin/cadastros/produtos/novo" });
  }, [buscaUrl, navigate]);

  const categorias = useQuery({
    queryKey: ["opcoes-categorias"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Leitor de código de barras: termo único e sem espaços tenta achar a peça exata
  // (código de barras, referência da etiqueta, SKU ou código interno).
  const termoCodigo = busca.trim();
  const podeSerCodigo = termoCodigo.length >= 1 && !/\s/.test(termoCodigo);

  const leitura = useQuery({
    queryKey: ["product-barcode-lookup", termoCodigo],
    enabled: podeSerCodigo,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("barcode_lookup", { _code: termoCodigo });
      if (error) throw error;
      const r = data as { encontrado: boolean; product_id?: string } | null;
      return r?.encontrado ? (r.product_id ?? null) : null;
    },
  });

  const idExato = podeSerCodigo ? (leitura.data ?? null) : null;
  const aguardandoLeitura = podeSerCodigo && leitura.isPending;

  const query = useQuery({
    queryKey: ["products", busca, pagina, status, categoria, idExato],
    enabled: !aguardandoLeitura,
    queryFn: () =>
      listPaged<ProdutoLinha>({
        table: "products",
        select: "id, slug, name, legacy_code, status, price_cents, price_is_public, category_id, collection_id",
        searchColumns: ["name", "slug", "legacy_code", "material", "short_description"],
        search: idExato ? "" : busca,
        page: idExato ? 0 : pagina,
        pageSize: PAGE_SIZE,
        orderBy: "created_at",
        filters: idExato
          ? { id: idExato }
          : { status, category_id: categoria },
      }),
  });

  const nomeCategoria = (id: string | null) =>
    categorias.data?.find((c) => c.id === id)?.name ?? "—";

  const columns: Column<ProdutoLinha>[] = [
    { key: "name", header: "Produto", render: (r) => r.name },
    { key: "legacy_code", header: "Código", render: (r) => <span className="num">{r.legacy_code ?? "—"}</span> },
    { key: "categoria", header: "Categoria", render: (r) => nomeCategoria(r.category_id) },
    {
      key: "preco",
      header: "Preço",
      className: "text-right",
      render: (r) =>
        r.price_cents == null ? (
          "—"
        ) : (
          <span className="num">
            {centavosParaTexto(r.price_cents)}
            {r.price_is_public ? "" : " (interno)"}
          </span>
        ),
    },
    {
      key: "status",
      header: "Situação",
      render: (r) => <StatusBadge tone={tone(r.status)}>{r.status}</StatusBadge>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cadastros"
        title="Produtos"
        description="Ficha da peça, variantes vendáveis, imagens e publicação no site."
        actions={
          <Link to="/admin/cadastros/produtos/novo" className="admin-btn border-champagne">
            <Plus aria-hidden className="size-4" /> Novo produto
          </Link>
        }
      />

      <div className="flex w-fit gap-1 rounded-xl border border-line bg-line-soft/40 p-1">
        {([
          ["visao", "Visão geral"],
          ["lista", "Lista de produtos"],
          ["corrigir", "Cadastros a corrigir"],
        ] as const).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setAba(valor)}
            aria-pressed={aba === valor}
            className={
              aba === valor
                ? "rounded-lg bg-ledger-panel px-4 py-2 text-[0.8125rem] font-semibold text-ledger-text shadow-sm"
                : "rounded-lg px-4 py-2 text-[0.8125rem] font-medium text-ledger-muted transition hover:text-ledger-text"
            }
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === "visao" && (
        <ProdutosVisaoGeral
          onAbrirPendencias={(tipo) => {
            setPendenciaTipo(tipo);
            setAba("corrigir");
          }}
        />
      )}

      {aba === "corrigir" && <ProdutosPendencias key={pendenciaTipo} tipoInicial={pendenciaTipo} />}

      {aba === "lista" && (
      <DataTable<ProdutoLinha>
        columns={columns}
        rows={query.data?.rows ?? []}
        rowKey={(r) => r.id}
        total={query.data?.total ?? 0}
        page={pagina}
        pageSize={PAGE_SIZE}
        onPageChange={setPagina}
        search={busca}
        onSearchChange={(v) => {
          setBusca(v);
          setPagina(0);
        }}
        searchPlaceholder="Leia o código de barras ou busque por nome, referência ou material…"
        isLoading={query.isLoading || aguardandoLeitura}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(row) => void navigate({ to: "/admin/cadastros/produtos/$id", params: { id: row.id } })}
        filters={
          <div className="flex flex-wrap items-center gap-3">
            <SmartSelect
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPagina(0);
              }}
              options={[{ value: "todos", label: "Todas as situações" }, ...STATUS_OPTIONS]}
              placeholder="Situação"
              className="w-52"
            />
            <SmartSelect
              value={categoria}
              onChange={(v) => {
                setCategoria(v);
                setPagina(0);
              }}
              options={[
                { value: "todos", label: "Todas as categorias" },
                ...(categorias.data ?? []).map((c) => ({ value: c.id, label: c.name })),
              ]}
              placeholder="Categoria"
              className="w-60"
            />
          </div>
        }
      />
      )}
    </div>
  );
}
