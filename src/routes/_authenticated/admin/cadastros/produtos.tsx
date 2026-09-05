import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatusBadge } from "@/components/admin/ui";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { RecordSheet } from "@/components/admin/RecordSheet";
import { SmartSelect } from "@/components/premium/SmartSelect";
import {
  listPaged,
  saveRecord,
  slugify,
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
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [status, setStatus] = useState("todos");
  const [categoria, setCategoria] = useState("todos");
  const [novo, setNovo] = useState(false);

  const categorias = useQuery({
    queryKey: ["opcoes-categorias"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const colecoes = useQuery({
    queryKey: ["opcoes-colecoes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collections").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const query = useQuery({
    queryKey: ["products", busca, pagina, status, categoria],
    queryFn: () =>
      listPaged<ProdutoLinha>({
        table: "products",
        select: "id, slug, name, legacy_code, status, price_cents, price_is_public, category_id, collection_id",
        searchColumns: ["name", "slug", "legacy_code", "material", "short_description"],
        search: busca,
        page: pagina,
        pageSize: PAGE_SIZE,
        orderBy: "created_at",
        filters: { status, category_id: categoria },
      }),
  });

  const criar = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const nome = String(values["name"] ?? "").trim();
      const row = await saveRecord("products", {
        name: nome,
        slug: String(values["slug"] || "").trim() || slugify(nome),
        legacy_code: values["legacy_code"] || null,
        category_id: values["category_id"] || null,
        collection_id: values["collection_id"] || null,
        short_description: values["short_description"] || null,
        status: "rascunho",
      });
      return row as { id: string };
    },
    onSuccess: (row) => {
      toast.success("Produto criado como rascunho.");
      void qc.invalidateQueries({ queryKey: ["products"] });
      void navigate({ to: "/admin/cadastros/produtos/$id", params: { id: row.id } });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível criar."),
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
          <button type="button" className="admin-btn border-champagne" onClick={() => setNovo(true)}>
            <Plus aria-hidden className="size-4" /> Novo produto
          </button>
        }
      />

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
        searchPlaceholder="Buscar por nome, código ou material…"
        isLoading={query.isLoading}
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

      <RecordSheet
        open={novo}
        onOpenChange={setNovo}
        title="Novo produto"
        description="Crie a ficha básica; variantes, imagens e preço são definidos na página do produto."
        fields={[
          { name: "name", label: "Nome do produto", type: "text", required: true, full: true },
          { name: "legacy_code", label: "Código legado", type: "text" },
          { name: "slug", label: "Endereço (slug)", type: "text", help: "Deixe vazio para gerar pelo nome." },
          {
            name: "category_id",
            label: "Categoria",
            type: "select",
            options: (categorias.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          },
          {
            name: "collection_id",
            label: "Coleção",
            type: "select",
            options: (colecoes.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          },
          { name: "short_description", label: "Resumo", type: "textarea", full: true },
        ]}
        initial={{}}
        onSubmit={async (values) => {
          await criar.mutateAsync(values);
        }}
      />
    </div>
  );
}
