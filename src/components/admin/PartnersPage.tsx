import { useEffect, useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Plus } from "lucide-react";
import { PageHeader, StatusBadge } from "@/components/admin/ui";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { RecordSheet, type FieldSpec, type RecordValues } from "@/components/admin/RecordSheet";
import {
  listPartners,
  revealPartnerDoc,
  savePartner,
  type PartnerDraft,
  type PartnerKind,
  type PartnerRow,
} from "@/lib/partners";
import { formatarDocumento, normalizarDocumento } from "@/lib/br/canonico";
import { UFS } from "@/lib/catalog";

const PAGE_SIZE = 20;

interface Props {
  kind: PartnerKind;
  eyebrow: string;
  title: string;
  description: string;
  novoLabel: string;
  nomeLabel: string;
  docLabel: string;
}

/**
 * Fornecedores e entidades: a lista vem do servidor já mascarada.
 * O documento completo só aparece por ação explícita e fica auditado.
 */
export function PartnersPage({
  kind,
  eyebrow,
  title,
  description,
  novoLabel,
  nomeLabel,
  docLabel,
}: Props) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<PartnerRow | null>(null);
  const [docEdicao, setDocEdicao] = useState<string | null>(null);
  const [revelados, setRevelados] = useState<Record<string, string>>({});

  const buscaUrl = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  useEffect(() => {
    if (buscaUrl?.["novo"]) {
      setEditando(null);
      setDocEdicao(null);
      setAberto(true);
    }
  }, [buscaUrl]);

  const query = useQuery({
    queryKey: ["parceiros", kind, busca, pagina],
    queryFn: () => listPartners({ kind, search: busca, page: pagina, pageSize: PAGE_SIZE }),
  });

  const podeRevelar = query.data?.pode_revelar ?? false;
  const podeGerir = query.data?.pode_gerir ?? false;

  const revelar = async (row: PartnerRow) => {
    try {
      const doc = await revealPartnerDoc(kind, row.id);
      setRevelados((r) => ({ ...r, [row.id]: doc ? formatarDocumento(doc) : "—" }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível revelar o documento.");
    }
  };

  const abrirEdicao = async (row: PartnerRow) => {
    setEditando(row);
    setDocEdicao(null);
    setAberto(true);
    if (podeRevelar && row.tem_doc) {
      try {
        const doc = await revealPartnerDoc(kind, row.id);
        setDocEdicao(doc ? formatarDocumento(doc) : "");
      } catch {
        setDocEdicao("");
      }
    }
  };

  const salvar = useMutation({
    mutationFn: async (values: RecordValues) => {
      const draft: PartnerDraft = {
        nome: String(values["nome"] ?? "").trim(),
        fantasia: (values["fantasia"] as string) || null,
        contato: (values["contato"] as string) || null,
        email: (values["email"] as string) || null,
        telefone: (values["telefone"] as string) || null,
        inscricao_estadual: (values["inscricao_estadual"] as string) || null,
        cidade: (values["cidade"] as string) || null,
        uf: (values["uf"] as string) || null,
        notas: (values["notas"] as string) || null,
        ativo: values["ativo"] !== false,
      };
      if (!draft.nome) throw new Error(`${nomeLabel} é obrigatório.`);
      if (podeRevelar) {
        const bruto = String(values["doc"] ?? "").trim();
        if (!bruto) {
          draft.doc = null;
        } else {
          const c = normalizarDocumento(bruto);
          if (c.estado !== "valido") throw new Error(c.erro ?? "Documento inválido.");
          draft.doc = c.canonico;
        }
      }
      return savePartner(kind, draft, editando?.id ?? null);
    },
    onSuccess: () => {
      toast.success("Registro salvo.");
      setRevelados({});
      void qc.invalidateQueries({ queryKey: ["parceiros", kind] });
    },
  });

  const colunas = useMemo<Column<PartnerRow>[]>(() => {
    const base: Column<PartnerRow>[] = [
      { key: "nome", header: nomeLabel, render: (r) => r.nome },
      { key: "fantasia", header: "Nome fantasia", render: (r) => r.fantasia ?? "—" },
      {
        key: "doc",
        header: docLabel,
        render: (r) => (
          <span className="flex items-center gap-2 tabular-nums">
            {revelados[r.id] ?? r.doc_mascarado ?? "—"}
            {podeRevelar && r.tem_doc && !revelados[r.id] ? (
              <button
                type="button"
                aria-label="Revelar documento"
                className="text-muted-foreground transition-colors hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  void revelar(r);
                }}
              >
                <Eye aria-hidden className="size-3.5" />
              </button>
            ) : null}
          </span>
        ),
      },
    ];
    if (kind === "fornecedor") {
      base.push({
        key: "contato",
        header: "Contato",
        render: (r) => r.contato ?? r.email ?? r.telefone ?? "—",
      });
    }
    base.push(
      {
        key: "praca",
        header: "Praça",
        render: (r) => (r.cidade ? `${r.cidade}${r.uf ? `/${r.uf}` : ""}` : "—"),
      },
      {
        key: "situacao",
        header: "Situação",
        render: (r) => (
          <StatusBadge tone={r.ativo ? "success" : "neutral"}>
            {r.ativo ? "Ativo" : "Inativo"}
          </StatusBadge>
        ),
      },
    );
    return base;
  }, [docLabel, kind, nomeLabel, podeRevelar, revelados]);

  const campos = useMemo<FieldSpec[]>(() => {
    const lista: FieldSpec[] = [
      { name: "nome", label: nomeLabel, type: "text", required: true, full: true },
      { name: "fantasia", label: "Nome fantasia", type: "text" },
    ];
    if (podeRevelar) {
      lista.push({
        name: "doc",
        label: docLabel,
        type: "text",
        help: "Somente perfis autorizados veem e alteram o documento.",
      });
    }
    if (kind === "entidade") {
      lista.push({ name: "inscricao_estadual", label: "Inscrição estadual", type: "text" });
    } else {
      lista.push(
        { name: "contato", label: "Pessoa de contato", type: "text" },
        { name: "email", label: "E-mail", type: "text" },
        { name: "telefone", label: "Telefone", type: "text" },
      );
    }
    lista.push(
      { name: "cidade", label: "Cidade", type: "text" },
      { name: "uf", label: "UF", type: "select", options: UFS.map((u) => ({ value: u, label: u })) },
      { name: "ativo", label: "Ativo", type: "switch" },
      { name: "notas", label: "Observações", type: "textarea" },
    );
    return lista;
  }, [docLabel, kind, nomeLabel, podeRevelar]);

  const initial = useMemo<RecordValues>(() => {
    if (!editando) return { ativo: true };
    return {
      nome: editando.nome,
      fantasia: editando.fantasia ?? "",
      doc: docEdicao ?? "",
      inscricao_estadual: editando.inscricao_estadual ?? "",
      contato: editando.contato ?? "",
      email: editando.email ?? "",
      telefone: editando.telefone ?? "",
      cidade: editando.cidade ?? "",
      uf: editando.uf ?? "",
      notas: editando.notas ?? "",
      ativo: editando.ativo,
    };
  }, [docEdicao, editando]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          podeGerir ? (
            <button
              type="button"
              className="admin-btn border-champagne"
              onClick={() => {
                setEditando(null);
                setDocEdicao(null);
                setAberto(true);
              }}
            >
              <Plus aria-hidden className="size-4" /> {novoLabel}
            </button>
          ) : null
        }
      />

      <DataTable<PartnerRow>
        columns={colunas}
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
        searchPlaceholder="Buscar por nome, cidade ou documento…"
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        {...(podeGerir ? { onRowClick: (row: PartnerRow) => void abrirEdicao(row) } : {})}
        emptyTitle="Sem registros"
        emptyDescription="Nenhum cadastro encontrado com a busca atual."
      />

      <RecordSheet
        open={aberto}
        onOpenChange={setAberto}
        title={editando ? "Editar cadastro" : novoLabel}
        description="Os dados ficam no cadastro único. O documento é gravado apenas pelo servidor."
        fields={campos}
        initial={initial}
        onSubmit={async (values) => {
          await salvar.mutateAsync(values);
          setAberto(false);
        }}
      />
    </div>
  );
}
