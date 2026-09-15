import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CadastroPage } from "@/components/admin/CadastroPage";
import { StatusBadge } from "@/components/admin/ui";
import { STATUS_OPTIONS_EDICAO, slugify } from "@/lib/catalog";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/cadastros/categorias")({
  component: CategoriasPage,
  head: () => ({
    meta: [
      { title: "Categorias e subcategorias — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

interface Categoria {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  position: number;
  status: string;
  parent_id: string | null;
}

const tone = (status: string) =>
  status === "publicado" ? "success" : status === "arquivado" ? "neutral" : "warning";

/** Categorias principais disponíveis para receber subcategorias. */
async function fetchPrincipais() {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .is("parent_id", null)
    .order("position");
  if (error) throw error;
  return (data ?? []) as { id: string; name: string }[];
}

function CategoriasPage() {
  const principais = useQuery({ queryKey: ["categories", "principais"], queryFn: fetchPrincipais });
  const nomePai = (id: string | null) =>
    id ? (principais.data?.find((c) => c.id === id)?.name ?? "—") : null;

  return (
    <CadastroPage<Categoria>
      table="categories"
      eyebrow="Cadastros"
      title="Categorias e subcategorias"
      description="Dois níveis: categoria principal e subcategoria. Só categorias publicadas aparecem no site. Nada é excluído: arquive."
      select="id, slug, name, description, seo_title, seo_description, position, status, parent_id"
      searchColumns={["name", "slug", "description"]}
      novoLabel="Nova categoria"
      orderBy="position"
      columns={[
        {
          key: "name",
          header: "Categoria",
          render: (r) => (
            <span>
              {r.parent_id && (
                <span className="text-ledger-muted">{nomePai(r.parent_id)} › </span>
              )}
              <span className="font-semibold">{r.name}</span>
            </span>
          ),
        },
        {
          key: "nivel",
          header: "Nível",
          render: (r) => (
            <StatusBadge tone={r.parent_id ? "neutral" : "success"}>
              {r.parent_id ? "Subcategoria" : "Categoria principal"}
            </StatusBadge>
          ),
        },
        { key: "slug", header: "Endereço", render: (r) => <span className="num">{r.slug}</span> },
        { key: "position", header: "Ordem", render: (r) => <span className="num">{r.position}</span> },
        {
          key: "status",
          header: "Situação",
          render: (r) => <StatusBadge tone={tone(r.status)}>{r.status}</StatusBadge>,
        },
      ]}
      fieldsFor={(atual) => [
        { name: "name", label: "Nome", type: "text", required: true },
        {
          name: "parent_id",
          label: "Categoria principal",
          type: "select",
          options: [
            { value: "", label: "Nenhuma — esta é uma categoria principal" },
            ...(principais.data ?? [])
              .filter((c) => c.id !== atual?.id)
              .map((c) => ({ value: c.id, label: c.name })),
          ],
          help: "Escolha uma categoria principal para transformar este registro em subcategoria.",
          full: true,
        },
        { name: "slug", label: "Endereço (slug)", type: "text", help: "Deixe vazio para gerar pelo nome." },
        { name: "position", label: "Ordem", type: "number" },
        { name: "description", label: "Descrição", type: "textarea" },
        { name: "seo_title", label: "Título para buscadores", type: "text", full: true },
        { name: "seo_description", label: "Descrição para buscadores", type: "textarea" },
        atual && atual.status === "publicado"
          ? {
              name: "status",
              label: "Situação",
              type: "select",
              options: [{ value: "publicado", label: "Publicado (visível no site)" }],
              help: "Está no ar. Para retirar do site, use Site › Categorias e coleções e informe o motivo.",
              full: true,
            }
          : {
              name: "status",
              label: "Situação",
              type: "select",
              options: STATUS_OPTIONS_EDICAO,
              required: true,
              help: "Publicar é feito em Site › Categorias e coleções, onde o sistema confere descrição, título público, texto para buscadores e imagem de capa antes de liberar a página.",
              full: true,
            },
      ]}
      prepare={(v) => {
        const nome = String(v["name"] ?? "").trim();
        const status = String(v["status"] || "rascunho");
        const pai = String(v["parent_id"] ?? "").trim();
        return {
          name: nome,
          slug: String(v["slug"] || "").trim() || slugify(nome),
          position: Number(v["position"] ?? 0) || 0,
          parent_id: pai || null,
          ...(status === "publicado" ? {} : { status }),
          description: v["description"] || null,
          seo_title: v["seo_title"] || null,
          seo_description: v["seo_description"] || null,
        };
      }}
    />
  );
}
