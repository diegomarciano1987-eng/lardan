import { createFileRoute } from "@tanstack/react-router";
import { CadastroPage } from "@/components/admin/CadastroPage";
import { StatusBadge } from "@/components/admin/ui";
import { UFS } from "@/lib/catalog";

export const Route = createFileRoute("/_authenticated/admin/cadastros/fornecedores")({
  component: FornecedoresPage,
  head: () => ({
    meta: [
      { title: "Fornecedores — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

interface Fornecedor {
  id: string;
  name: string;
  trade_name: string | null;
  tax_id: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  uf: string | null;
  notes: string | null;
  is_active: boolean;
}

function FornecedoresPage() {
  return (
    <CadastroPage<Fornecedor>
      table="suppliers"
      eyebrow="Cadastros"
      title="Fornecedores"
      description="Origem das peças. O documento é único quando informado."
      select="id, name, trade_name, tax_id, contact_name, email, phone, city, uf, notes, is_active"
      searchColumns={["name", "trade_name", "tax_id", "contact_name", "email", "city"]}
      novoLabel="Novo fornecedor"
      columns={[
        { key: "name", header: "Fornecedor", render: (r) => r.name },
        { key: "tax_id", header: "Documento", render: (r) => r.tax_id ?? "—" },
        { key: "contato", header: "Contato", render: (r) => r.contact_name ?? r.email ?? r.phone ?? "—" },
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
              {r.is_active ? "Ativo" : "Inativo"}
            </StatusBadge>
          ),
        },
      ]}
      fields={[
        { name: "name", label: "Razão social / nome", type: "text", required: true, full: true },
        { name: "trade_name", label: "Nome fantasia", type: "text" },
        { name: "tax_id", label: "CNPJ ou CPF", type: "text", help: "Zeros à esquerda são preservados." },
        { name: "contact_name", label: "Pessoa de contato", type: "text" },
        { name: "email", label: "E-mail", type: "text" },
        { name: "phone", label: "Telefone", type: "text" },
        { name: "city", label: "Cidade", type: "text" },
        { name: "uf", label: "UF", type: "select", options: UFS.map((u) => ({ value: u, label: u })) },
        { name: "is_active", label: "Ativo", type: "switch" },
        { name: "notes", label: "Observações", type: "textarea" },
      ]}
      toForm={(r) => ({ ...r, is_active: r.is_active })}
      prepare={(v) => ({
        name: String(v["name"] ?? "").trim(),
        trade_name: v["trade_name"] || null,
        tax_id: v["tax_id"] ? String(v["tax_id"]).trim() : null,
        contact_name: v["contact_name"] || null,
        email: v["email"] || null,
        phone: v["phone"] || null,
        city: v["city"] || null,
        uf: v["uf"] || null,
        notes: v["notes"] || null,
        is_active: v["is_active"] !== false,
      })}
    />
  );
}
