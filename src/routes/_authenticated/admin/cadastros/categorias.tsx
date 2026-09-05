import { createFileRoute } from "@tanstack/react-router";
import { CadastroPage } from "@/components/admin/CadastroPage";
import { StatusBadge } from "@/components/admin/ui";
import { STATUS_OPTIONS, slugify } from "@/lib/catalog";

export const Route = createFileRoute("/_authenticated/admin/cadastros/categorias")({
  component: CategoriasPage,
  head: () => ({
    meta: [
      { title: "Categorias — Administração LARDAN" },
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
}

const tone = (status: string) =>
  status === "publicado" ? "success" : status === "arquivado" ? "neutral" : "warning";

function CategoriasPage() {
  return (
    <CadastroPage<Categoria>
      table="categories"
      eyebrow="Cadastros"
      title="Categorias"
      description="Só categorias publicadas aparecem no site. Nada é excluído: arquive."
      select="id, slug, name, description, seo_title, seo_description, position, status"
      searchColumns={["name", "slug", "description"]}
      novoLabel="Nova categoria"
      orderBy="position"
      columns={[
        { key: "name", header: "Categoria", render: (r) => r.name },
        { key: "slug", header: "Endereço", render: (r) => <span className="num">{r.slug}</span> },
        { key: "position", header: "Ordem", render: (r) => <span className="num">{r.position}</span> },
        {
          key: "status",
          header: "Situação",
          render: (r) => <StatusBadge tone={tone(r.status)}>{r.status}</StatusBadge>,
        },
      ]}
      fields={[
        { name: "name", label: "Nome", type: "text", required: true },
        { name: "slug", label: "Endereço (slug)", type: "text", help: "Deixe vazio para gerar pelo nome." },
        { name: "position", label: "Ordem", type: "number" },
        { name: "status", label: "Situação", type: "select", options: STATUS_OPTIONS, required: true },
        { name: "description", label: "Descrição", type: "textarea" },
        { name: "seo_title", label: "Título para buscadores", type: "text", full: true },
        { name: "seo_description", label: "Descrição para buscadores", type: "textarea" },
      ]}
      prepare={(v) => {
        const nome = String(v["name"] ?? "").trim();
        const status = String(v["status"] || "rascunho");
        return {
          name: nome,
          slug: String(v["slug"] || "").trim() || slugify(nome),
          position: Number(v["position"] ?? 0) || 0,
          status,
          description: v["description"] || null,
          seo_title: v["seo_title"] || null,
          seo_description: v["seo_description"] || null,
          published_at: status === "publicado" ? new Date().toISOString() : null,
        };
      }}
    />
  );
}
