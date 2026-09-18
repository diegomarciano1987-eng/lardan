import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { StatusBadge, formatBRLFromCents, formatInt } from "@/components/admin/ui";

type Tipo = "sem_custo" | "sem_preco" | "sem_ncm" | "sem_referencia";

interface Pendencia {
  id: string;
  name: string;
  status: string;
  custo: number;
  venda: number;
  ncm: string | null;
  reference_code: string | null;
  barcode: string | null;
}

interface Resposta {
  tipo: Tipo;
  total: number;
  itens: Pendencia[];
}

const PAGE_SIZE = 25;

const ABAS: { valor: Tipo; rotulo: string }[] = [
  { valor: "sem_custo", rotulo: "Sem custo" },
  { valor: "sem_preco", rotulo: "Sem preço" },
  { valor: "sem_ncm", rotulo: "Sem NCM" },
  { valor: "sem_referencia", rotulo: "Sem referência" },
];

const tone = (status: string) =>
  status === "publicado" ? "success" : status === "arquivado" ? "neutral" : "warning";

export function ProdutosPendencias({ tipoInicial = "sem_custo" }: { tipoInicial?: Tipo }) {
  const navigate = useNavigate();
  const [tipo, setTipo] = useState<Tipo>(tipoInicial);
  const [pagina, setPagina] = useState(0);
  const [busca, setBusca] = useState("");

  const query = useQuery({
    queryKey: ["catalog-pendencias", tipo, busca, pagina],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("catalog_pendencias", {
        _tipo: tipo,
        _busca: busca.trim() === "" ? undefined : busca.trim(),
        _limite: PAGE_SIZE,
        _offset: pagina * PAGE_SIZE,
      });
      if (error) throw error;
      return data as unknown as Resposta;
    },
  });

  const columns: Column<Pendencia>[] = [
    { key: "name", header: "Produto", render: (r) => r.name },
    {
      key: "barcode",
      header: "Código de barras",
      render: (r) => <span className="num">{r.barcode ?? "—"}</span>,
    },
    {
      key: "reference_code",
      header: "Referência",
      render: (r) => <span className="num">{r.reference_code ?? "—"}</span>,
    },
    { key: "ncm", header: "NCM", render: (r) => <span className="num">{r.ncm ?? "—"}</span> },
    {
      key: "custo",
      header: "Custo",
      className: "text-right",
      render: (r) => <span className="num">{r.custo > 0 ? formatBRLFromCents(r.custo) : "—"}</span>,
    },
    {
      key: "venda",
      header: "Venda",
      className: "text-right",
      render: (r) => <span className="num">{r.venda > 0 ? formatBRLFromCents(r.venda) : "—"}</span>,
    },
    {
      key: "status",
      header: "Situação",
      render: (r) => <StatusBadge tone={tone(r.status)}>{r.status}</StatusBadge>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-line-soft/40 p-1">
        {ABAS.map((a) => (
          <button
            key={a.valor}
            type="button"
            aria-pressed={tipo === a.valor}
            onClick={() => {
              setTipo(a.valor);
              setPagina(0);
            }}
            className={
              tipo === a.valor
                ? "rounded-lg bg-ledger-panel px-4 py-2 text-[0.8125rem] font-semibold text-ledger-text shadow-sm"
                : "rounded-lg px-4 py-2 text-[0.8125rem] font-medium text-ledger-muted transition hover:text-ledger-text"
            }
          >
            {a.rotulo}
          </button>
        ))}
        <span className="ml-auto self-center px-3 text-[0.8125rem] text-ledger-muted">
          {query.data ? `${formatInt(query.data.total)} peças` : ""}
        </span>
      </div>

      <DataTable<Pendencia>
        columns={columns}
        rows={query.data?.itens ?? []}
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
        searchPlaceholder="Busque por nome, referência ou código de barras…"
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(row) =>
          void navigate({ to: "/admin/cadastros/produtos/$id", params: { id: row.id } })
        }
      />
    </div>
  );
}
