import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute as _unused } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { CadastroPage } from "@/components/admin/CadastroPage";
import { StatusBadge } from "@/components/admin/ui";
import { UFS } from "@/lib/catalog";

export const Route = createFileRoute("/_authenticated/admin/cadastros/locais")({
  component: LocaisPage,
  head: () => ({
    meta: [
      { title: "Locais físicos — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

void _unused;

interface Local {
  id: string;
  code: string;
  name: string;
  kind: string;
  business_entity_id: string | null;
  responsible_user_id: string | null;
  address: string | null;
  city: string | null;
  uf: string | null;
  notes: string | null;
  is_active: boolean;
}

const TIPOS = [
  { value: "deposito", label: "Depósito" },
  { value: "loja", label: "Loja" },
  { value: "maleta", label: "Maleta" },
  { value: "transito", label: "Trânsito" },
  { value: "outro", label: "Outro" },
];

function LocaisPage() {
  const entidades = useQuery({
    queryKey: ["opcoes-entidades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_entities")
        .select("id, legal_name")
        .eq("is_active", true)
        .order("legal_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const pessoas = useQuery({
    queryKey: ["opcoes-responsaveis"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("is_active", true)
        .order("email");
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <CadastroPage<Local>
      table="locations"
      eyebrow="Cadastros"
      title="Locais físicos"
      description="Onde o estoque existe de verdade. Todo movimento futuro aponta para um local."
      select="id, code, name, kind, business_entity_id, responsible_user_id, address, city, uf, notes, is_active"
      searchColumns={["code", "name", "city", "address"]}
      novoLabel="Novo local"
      orderBy="code"
      columns={[
        { key: "code", header: "Código", render: (r) => <span className="num">{r.code}</span> },
        { key: "name", header: "Local", render: (r) => r.name },
        {
          key: "kind",
          header: "Tipo",
          render: (r) => TIPOS.find((t) => t.value === r.kind)?.label ?? r.kind,
        },
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
        { name: "code", label: "Código", type: "text", required: true, help: "Zeros à esquerda preservados." },
        { name: "name", label: "Nome do local", type: "text", required: true },
        { name: "kind", label: "Tipo", type: "select", options: TIPOS, required: true },
        {
          name: "business_entity_id",
          label: "Entidade de negócio",
          type: "select",
          options: (entidades.data ?? []).map((e) => ({ value: e.id, label: e.legal_name })),
        },
        {
          name: "responsible_user_id",
          label: "Responsável",
          type: "select",
          options: (pessoas.data ?? []).map((p) => ({
            value: p.id,
            label: p.full_name ?? p.email ?? p.id,
          })),
        },
        { name: "address", label: "Endereço", type: "text", full: true },
        { name: "city", label: "Cidade", type: "text" },
        { name: "uf", label: "UF", type: "select", options: UFS.map((u) => ({ value: u, label: u })) },
        { name: "is_active", label: "Ativo", type: "switch" },
        { name: "notes", label: "Observações", type: "textarea" },
      ]}
      prepare={(v) => ({
        code: String(v["code"] ?? "").trim(),
        name: String(v["name"] ?? "").trim(),
        kind: v["kind"] || "deposito",
        business_entity_id: v["business_entity_id"] || null,
        responsible_user_id: v["responsible_user_id"] || null,
        address: v["address"] || null,
        city: v["city"] || null,
        uf: v["uf"] || null,
        notes: v["notes"] || null,
        is_active: v["is_active"] !== false,
      })}
    />
  );
}
