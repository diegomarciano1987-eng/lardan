import { createFileRoute, Link } from "@tanstack/react-router";
import { Tag, Layers, Boxes, Truck, MapPin, Building2 } from "lucide-react";
import { PageHeader } from "@/components/admin/ui";

export const Route = createFileRoute("/_authenticated/admin/cadastros/")({
  component: CadastrosHub,
  head: () => ({
    meta: [
      { title: "Cadastros — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const ITENS = [
  {
    to: "/admin/cadastros/produtos",
    label: "Produtos e variantes",
    icon: Tag,
    texto: "Ficha do produto, variantes vendáveis, SKU, código de barras, imagens e preço.",
  },
  {
    to: "/admin/cadastros/categorias",
    label: "Categorias",
    icon: Layers,
    texto: "Organização do catálogo público, com publicação e arquivamento.",
  },
  {
    to: "/admin/cadastros/colecoes",
    label: "Coleções",
    icon: Boxes,
    texto: "Agrupamentos temáticos e sazonais das peças.",
  },
  {
    to: "/admin/cadastros/fornecedores",
    label: "Fornecedores",
    icon: Truck,
    texto: "Quem fornece as peças, com contato e documento.",
  },
  {
    to: "/admin/cadastros/locais",
    label: "Locais físicos",
    icon: MapPin,
    texto: "Depósitos, lojas e maletas onde o estoque existe de verdade.",
  },
  {
    to: "/admin/cadastros/entidades",
    label: "Entidades de negócio",
    icon: Building2,
    texto: "Empresas do grupo às quais o estoque e o financeiro pertencem.",
  },
] as const;

function CadastrosHub() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Fundação"
        title="Cadastros"
        description="Tudo o que o estoque, o site e o financeiro usam como verdade única."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {ITENS.map((i) => (
          <Link
            key={i.to}
            to={i.to}
            className="ledger-panel flex flex-col gap-2 p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg"
          >
            <i.icon aria-hidden className="size-5 text-bronze" />
            <h2 className="text-lg font-semibold text-ledger-text">{i.label}</h2>
            <p className="text-sm font-medium text-ledger-muted">{i.texto}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
