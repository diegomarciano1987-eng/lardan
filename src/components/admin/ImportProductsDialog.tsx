import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { supabase } from "@/integrations/supabase/client";
import { listStockLocations } from "@/lib/stock";
import { parseCentavos } from "@/lib/catalog";
import { formatInt } from "@/components/admin/ui";

interface LinhaImport {
  nome: string;
  sku: string;
  codigo_barras: string;
  categoria: string;
  colecao: string;
  quantidade: number;
  custo_cents: number | null;
  preco_cents: number | null;
  cor: string;
  tamanho: string;
}

interface ResultadoImport {
  produtos_criados: number;
  variantes_criadas: number;
  variantes_atualizadas: number;
  unidades_entradas: number;
  erros: { linha: number; erro: string }[];
}

/** Reconhece cabeçalhos com ou sem acento, maiúsculas ou variações comuns. */
function normalizarCabecalho(h: string) {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MAPA_COLUNAS: [keyof LinhaImport, string[]][] = [
  ["nome", ["nome", "produto", "nome do produto", "descricao", "peca"]],
  ["sku", ["sku", "codigo", "codigo interno", "referencia", "ref"]],
  ["codigo_barras", ["codigo de barras", "barcode", "ean", "gtin", "cod barras"]],
  ["categoria", ["categoria"]],
  ["colecao", ["colecao", "linha"]],
  ["quantidade", ["quantidade", "qtd", "estoque", "saldo", "quantidades"]],
  ["custo_cents", ["valor de custo", "custo", "preco de custo", "valor custo"]],
  ["preco_cents", ["preco", "valor", "preco de venda", "valor de venda", "preco venda"]],
  ["cor", ["cor"]],
  ["tamanho", ["tamanho", "tam"]],
];

function parsePlanilha(buffer: ArrayBuffer): LinhaImport[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  if (!sheet) return [];
  const bruto = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const linhas: LinhaImport[] = [];

  for (const reg of bruto) {
    const porCabecalho = new Map<string, unknown>();
    for (const [k, v] of Object.entries(reg)) porCabecalho.set(normalizarCabecalho(k), v);

    const pega = (chave: keyof LinhaImport): string => {
      const aliases = MAPA_COLUNAS.find(([c]) => c === chave)?.[1] ?? [];
      for (const a of aliases) {
        const v = porCabecalho.get(a);
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
      }
      return "";
    };

    const nome = pega("nome");
    if (!nome) continue;
    const qtd = Number(String(pega("quantidade")).replace(",", "."));
    linhas.push({
      nome,
      sku: pega("sku"),
      codigo_barras: pega("codigo_barras"),
      categoria: pega("categoria"),
      colecao: pega("colecao"),
      quantidade: Number.isFinite(qtd) && qtd > 0 ? Math.floor(qtd) : 0,
      custo_cents: parseCentavos(pega("custo_cents")),
      preco_cents: parseCentavos(pega("preco_cents")),
      cor: pega("cor"),
      tamanho: pega("tamanho"),
    });
  }
  return linhas;
}

/** Importação em massa de produtos com entrada de estoque, tudo gravado pelo banco. */
export function ImportProductsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [linhas, setLinhas] = React.useState<LinhaImport[]>([]);
  const [arquivo, setArquivo] = React.useState("");
  const [localId, setLocalId] = React.useState("");
  const [resultado, setResultado] = React.useState<ResultadoImport | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  /** "entrada" também lança estoque; "catalogo" só cadastra as peças. */
  const [modo, setModo] = React.useState<"entrada" | "catalogo">("entrada");
  /** Chave do lote: reenviar a mesma planilha não duplica entradas. */
  const chave = React.useRef(crypto.randomUUID());
  React.useEffect(() => {
    if (open) chave.current = crypto.randomUUID();
  }, [open]);

  const locais = useQuery({ queryKey: ["stock-locations"], queryFn: listStockLocations });


  const importar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("import_products_stock" as never, {
        _rows: linhas,
        _location_id: localId || null,
        _mode: modo,
        _job_key: chave.current,
      } as never);
      if (error) throw error;
      return data as unknown as ResultadoImport;
    },
    onSuccess: (r) => {
      setResultado(r);
      void qc.invalidateQueries({ queryKey: ["stock"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      if (r.erros.length === 0) {
        toast.success(
          `Importação concluída: ${formatInt(r.produtos_criados)} produtos, ${formatInt(r.unidades_entradas)} unidades.`,
        );
      } else {
        toast.warning(`Importação parcial: ${r.erros.length} linha(s) com erro.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const aoEscolherArquivo = async (file: File) => {
    setArquivo(file.name);
    setResultado(null);
    try {
      const buf = await file.arrayBuffer();
      const lidas = parsePlanilha(buf);
      setLinhas(lidas);
      if (lidas.length === 0) {
        toast.error("Nenhuma linha com nome de produto foi encontrada na planilha.");
      }
    } catch {
      toast.error("Não consegui ler este arquivo. Use .xlsx ou .csv.");
      setLinhas([]);
    }
  };

  const fechar = (v: boolean) => {
    if (!v) {
      setLinhas([]);
      setArquivo("");
      setResultado(null);
    }
    onOpenChange(v);
  };

  const totalUnidades = linhas.reduce((acc, l) => acc + l.quantidade, 0);

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Importar produtos por planilha</DialogTitle>
          <DialogDescription>
            Envie um Excel (.xlsx) ou CSV com as colunas: nome do produto, SKU, categoria, coleção,
            código de barras, quantidade, valor de custo e preço. Peças com SKU ou código de barras
            já cadastrados são apenas atualizadas — nada é duplicado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-64">
              <span className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
                Planilha
              </span>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void aoEscolherArquivo(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="admin-btn mt-1.5"
              >
                <FileSpreadsheet aria-hidden className="mr-2 inline size-4" />
                {arquivo || "Escolher arquivo"}
              </button>
            </div>
            <label className="block w-64 space-y-1.5">
              <span className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
                Local de entrada do estoque
              </span>
              <SmartSelect
                options={(locais.data ?? []).map((l) => ({
                  value: l.id,
                  label: l.name,
                  hint: l.code,
                }))}
                value={localId}
                onChange={setLocalId}
                placeholder="Escolha o local…"
              />
            </label>
          </div>

          {linhas.length > 0 && !resultado && (
            <>
              <div className="ledger-panel max-h-72 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
                      <th className="px-3 py-2">Produto</th>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">Categoria</th>
                      <th className="px-3 py-2 text-right">Qtd.</th>
                      <th className="px-3 py-2 text-right">Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.slice(0, 50).map((l, i) => (
                      <tr key={i} className="border-t border-line/60">
                        <td className="px-3 py-2 font-medium text-ledger-text">{l.nome}</td>
                        <td className="px-3 py-2 text-ledger-muted">{l.sku || "—"}</td>
                        <td className="px-3 py-2 text-ledger-muted">{l.categoria || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatInt(l.quantidade)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ledger-muted">
                          {l.custo_cents !== null
                            ? `R$ ${(l.custo_cents / 100).toFixed(2).replace(".", ",")}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {linhas.length > 50 && (
                  <p className="px-3 py-2 text-xs text-ledger-muted">
                    … e mais {formatInt(linhas.length - 50)} linhas.
                  </p>
                )}
              </div>
              <p className="text-sm text-ledger-muted">
                {formatInt(linhas.length)} produtos lidos · {formatInt(totalUnidades)} unidades
                entrarão no local escolhido.
              </p>
            </>
          )}

          {resultado && (
            <div className="ledger-panel space-y-2 px-5 py-4 text-sm">
              <p className="font-semibold text-ledger-text">Resultado da importação</p>
              <p className="text-ledger-muted">
                {formatInt(resultado.produtos_criados)} produtos criados ·{" "}
                {formatInt(resultado.variantes_criadas)} variações novas ·{" "}
                {formatInt(resultado.variantes_atualizadas)} variações atualizadas ·{" "}
                {formatInt(resultado.unidades_entradas)} unidades lançadas no estoque.
              </p>
              {resultado.erros.length > 0 && (
                <ul className="list-inside list-disc text-xs text-red-700">
                  {resultado.erros.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      Linha {e.linha + 1}: {e.erro}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => fechar(false)} className="admin-btn">
              {resultado ? "Fechar" : "Cancelar"}
            </button>
            {!resultado && (
              <button
                type="button"
                className="admin-btn-primary"
                disabled={linhas.length === 0 || !localId || importar.isPending}
                onClick={() => importar.mutate()}
              >
                <Upload aria-hidden className="mr-2 inline size-4" />
                {importar.isPending ? "Importando…" : "Importar agora"}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
