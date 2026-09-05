import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, StatusBadge } from "@/components/admin/ui";
import { DataTable } from "@/components/admin/DataTable";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { NewRecordPicker } from "@/components/admin/NewRecordPicker";
import { useCapabilities } from "@/lib/capabilities";
import { maskDoc, formatDoc } from "@/lib/docs-br";
import {
  listParties,
  PARTY_ROLE_LABEL,
  PARTY_STATUS_LABEL,
  type Party,
  type PartyKind,
  type PartyRoleKind,
  type PartyStatus,
} from "@/lib/registry";
import { formatDateTime } from "@/components/admin/ui";

export const Route = createFileRoute("/_authenticated/admin/cadastros/pessoas")({
  component: PessoasPage,
  head: () => ({
    meta: [
      { title: "Pessoas e empresas — Central de Cadastros LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const PAGE_SIZE = 20;

function PessoasPage() {
  const caps = useCapabilities();
  const podeVerDoc = caps.includes("registry.doc.view");
  const navigate = useNavigate();

  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [kind, setKind] = useState<PartyKind | "todos">("todos");
  const [role, setRole] = useState<PartyRoleKind | "todos">("todos");
  const [status, setStatus] = useState<PartyStatus | "todos">("todos");

  const query = useQuery({
    queryKey: ["registry", "parties", busca, pagina, kind, role, status],
    queryFn: () => listParties({ search: busca, page: pagina, pageSize: PAGE_SIZE, kind, role, status }),
  });

  const filtro = (
    <div className="flex flex-wrap items-center gap-2">
      <SmartSelect
        className="w-40"
        value={kind}
        onChange={(v) => {
          setKind(v as PartyKind | "todos");
          setPagina(0);
        }}
        options={[
          { value: "todos", label: "Pessoas e empresas" },
          { value: "pessoa", label: "Somente pessoas" },
          { value: "organizacao", label: "Somente empresas" },
        ]}
      />
      <SmartSelect
        className="w-40"
        value={role}
        onChange={(v) => {
          setRole(v as PartyRoleKind | "todos");
          setPagina(0);
        }}
        options={[
          { value: "todos", label: "Todos os papéis" },
          ...Object.entries(PARTY_ROLE_LABEL).map(([value, label]) => ({ value, label })),
        ]}
      />
      <SmartSelect
        className="w-40"
        value={status}
        onChange={(v) => {
          setStatus(v as PartyStatus | "todos");
          setPagina(0);
        }}
        options={[
          { value: "todos", label: "Todas as situações" },
          ...Object.entries(PARTY_STATUS_LABEL).map(([value, label]) => ({ value, label })),
        ]}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Base operacional · Cadastros"
        title="Pessoas e empresas"
        description="Identidade única: a mesma pessoa pode ser candidata, consultora, cliente e colaboradora sem cadastro repetido."
        actions={<NewRecordPicker />}
      />

      <DataTable<Party>
        columns={[
          {
            key: "nome",
            header: "Nome",
            render: (r) => (
              <span className="font-semibold">
                {r.display_name?.trim() || r.legal_name?.trim() || (
                  <span className="text-ledger-muted italic">Sem nome informado</span>
                )}
              </span>
            ),
          },
          { key: "code", header: "Código", render: (r) => <span className="num">{r.code}</span> },
          {
            key: "doc",
            header: "Documento",
            render: (r) => (
              <span className="num">{r.doc_digits ? (podeVerDoc ? formatDoc(r.doc_digits) : maskDoc(r.doc_digits)) : "—"}</span>
            ),
          },
          {
            key: "tipo",
            header: "Tipo",
            render: (r) => (r.kind === "pessoa" ? "Pessoa" : "Empresa"),
          },
          {
            key: "status",
            header: "Situação",
            render: (r) => (
              <StatusBadge
                tone={
                  r.status === "ativo"
                    ? "success"
                    : r.status === "bloqueado" || r.status === "desligado"
                      ? "danger"
                      : r.status === "rascunho"
                        ? "warning"
                        : "neutral"
                }
              >
                {PARTY_STATUS_LABEL[r.status]}
              </StatusBadge>
            ),
          },
          {
            key: "updated",
            header: "Última alteração",
            render: (r) => <span className="num text-xs">{formatDateTime(r.updated_at)}</span>,
          },
        ]}
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
        searchPlaceholder="Nome, código interno ou documento…"
        filters={filtro}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(r) => void navigate({ to: "/admin/cadastros/pessoas/$id", params: { id: r.id } })}
        emptyTitle="Nenhum cadastro"
        emptyDescription="Nenhuma pessoa ou empresa encontrada com os filtros atuais."
      />
    </div>
  );
}
