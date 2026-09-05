import { createFileRoute } from "@tanstack/react-router";
import { CadastroPage } from "@/components/admin/CadastroPage";
import { StatusBadge } from "@/components/admin/ui";
import { UFS } from "@/lib/catalog";

export const Route = createFileRoute("/_authenticated/admin/cadastros/entidades")({
  component: EntidadesPage,
  head: () => ({
    meta: [
      { title: "Entidades de negócio — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

interface Entidade {
  id: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
  state_registration: string | null;
  city: string | null;
  uf: string | null;
  notes: string | null;
  is_active: boolean;
}

function EntidadesPage() {
  return (
    <CadastroPage<Entidade>
      table="business_entities"
      eyebrow="Cadastros"
      title="Entidades de negócio"
      description="Empresas do grupo. O estoque e o financeiro sempre pertencem a uma delas."
      select="id, legal_name, trade_name, tax_id, state_registration, city, uf, notes, is_active"
      searchColumns={["legal_name", "trade_name", "tax_id", "city"]}
      novoLabel="Nova entidade"
      columns={[
        { key: "legal_name", header: "Razão social", render: (r) => r.legal_name },
        { key: "trade_name", header: "Nome fantasia", render: (r) => r.trade_name ?? "—" },
        { key: "tax_id", header: "CNPJ", render: (r) => r.tax_id ?? "—" },
        {
          key: "praca",
          header: "Praça",
          render: (r) => (r.city ? `${r.city}${r.uf ? `/${r.uf}` : ""}` : "—"),
        },
        {
          key: "situacao",
          header: "Situação",
          render: (r) => (
            <StatusBadge tone={r.is_active ? "success" : "neutral"}>
              {r.is_active ? "Ativa" : "Inativa"}
            </StatusBadge>
          ),
        },
      ]}
      fields={[
        { name: "legal_name", label: "Razão social", type: "text", required: true, full: true },
        { name: "trade_name", label: "Nome fantasia", type: "text" },
        { name: "tax_id", label: "CNPJ", type: "text" },
        { name: "state_registration", label: "Inscrição estadual", type: "text" },
        { name: "city", label: "Cidade", type: "text" },
        { name: "uf", label: "UF", type: "select", options: UFS.map((u) => ({ value: u, label: u })) },
        { name: "is_active", label: "Ativa", type: "switch" },
        { name: "notes", label: "Observações", type: "textarea" },
      ]}
      prepare={(v) => ({
        legal_name: String(v["legal_name"] ?? "").trim(),
        trade_name: v["trade_name"] || null,
        tax_id: v["tax_id"] ? String(v["tax_id"]).trim() : null,
        state_registration: v["state_registration"] || null,
        city: v["city"] || null,
        uf: v["uf"] || null,
        notes: v["notes"] || null,
        is_active: v["is_active"] !== false,
      })}
    />
  );
}
