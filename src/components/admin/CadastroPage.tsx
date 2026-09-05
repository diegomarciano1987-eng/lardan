import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/admin/ui";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { RecordSheet, type FieldSpec, type RecordValues } from "@/components/admin/RecordSheet";
import { listPaged, saveRecord, type CadastroTable } from "@/lib/catalog";

const PAGE_SIZE = 20;

interface Props<T extends { id: string }> {
  table: CadastroTable;
  eyebrow: string;
  title: string;
  description: string;
  select: string;
  searchColumns: string[];
  columns: Column<T>[];
  fields: FieldSpec[];
  /** Transformação antes de gravar (slug, maiúsculas, etc.). */
  prepare?: (values: RecordValues) => RecordValues;
  toForm?: (row: T) => RecordValues;
  novoLabel?: string;
  orderBy?: string;
}

/** Tela padrão de cadastro-base: listar, buscar, paginar, criar e editar. */
export function CadastroPage<T extends { id: string }>({
  table,
  eyebrow,
  title,
  description,
  select,
  searchColumns,
  columns,
  fields,
  prepare,
  toForm,
  novoLabel = "Novo registro",
  orderBy = "created_at",
}: Props<T>) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<T | null>(null);

  const query = useQuery({
    queryKey: [table, busca, pagina],
    queryFn: () =>
      listPaged<T>({
        table,
        select,
        searchColumns,
        search: busca,
        page: pagina,
        pageSize: PAGE_SIZE,
        orderBy,
      }),
  });

  const salvar = useMutation({
    mutationFn: async (values: RecordValues) => {
      const payload = prepare ? prepare(values) : values;
      return saveRecord(table, payload, editando?.id);
    },
    onSuccess: () => {
      toast.success("Registro salvo.");
      void qc.invalidateQueries({ queryKey: [table] });
    },
  });

  const initial = useMemo<RecordValues>(() => {
    if (!editando) return {};
    return toForm ? toForm(editando) : (editando as unknown as RecordValues);
  }, [editando, toForm]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <button
            type="button"
            className="admin-btn border-champagne"
            onClick={() => {
              setEditando(null);
              setAberto(true);
            }}
          >
            <Plus aria-hidden className="size-4" /> {novoLabel}
          </button>
        }
      />

      <DataTable<T>
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
        searchPlaceholder="Buscar por qualquer parte do texto…"
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(row) => {
          setEditando(row);
          setAberto(true);
        }}
      />

      <RecordSheet
        open={aberto}
        onOpenChange={setAberto}
        title={editando ? `Editar — ${title}` : novoLabel}
        description="Toda alteração é registrada na auditoria com autor, data e valores anterior e novo."
        fields={fields}
        initial={initial}
        onSubmit={async (values) => {
          await salvar.mutateAsync(values);
        }}
      />
    </div>
  );
}
