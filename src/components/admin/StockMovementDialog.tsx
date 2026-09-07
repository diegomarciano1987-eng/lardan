import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { VariantPicker, type VariantOption } from "@/components/admin/VariantPicker";
import { useCapabilities } from "@/lib/capabilities";
import {
  MOVE_LABEL,
  listStockLocations,
  listStockReasons,
  registerMovement,
  type StockMoveKind,
} from "@/lib/stock";
import { parseCentavos } from "@/lib/catalog";
import { formatBRLFromCents } from "@/components/admin/ui";

const TIPOS: { value: StockMoveKind; label: string; hint: string }[] = [
  { value: "entrada", label: "Entrada", hint: "recebimento, devolução, retorno" },
  { value: "saida", label: "Saída", hint: "venda, envio, perda" },
  { value: "transferencia", label: "Transferência", hint: "entre dois locais" },
  { value: "ajuste", label: "Ajuste", hint: "correção pontual" },
  { value: "inventario", label: "Contagem pontual", hint: "define a quantidade contada" },
];

/** Motivos que exigem justificativa escrita. */
const MOTIVO_ESCRITO = ["perda", "avaria"];
/** Motivos que exigem documento de referência. */
const MOTIVO_COM_DOCUMENTO = ["compra"];

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

/** Registro de movimentação: saldo e razão gravados juntos pelo banco. */
export function StockMovementDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const caps = useCapabilities();
  /** Custo só existe na tela para Master, Diretoria e Financeiro. */
  const podeCusto = caps.includes("stock.cost.view");

  const [kind, setKind] = React.useState<StockMoveKind>("entrada");
  const [variant, setVariant] = React.useState<VariantOption | null>(null);
  const [quantidade, setQuantidade] = React.useState("");
  const [origem, setOrigem] = React.useState("");
  const [destino, setDestino] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [custo, setCusto] = React.useState("");
  const [referencia, setReferencia] = React.useState("");
  const [nota, setNota] = React.useState("");
  const [confirmar, setConfirmar] = React.useState(false);

  const locais = useQuery({ queryKey: ["stock-locations"], queryFn: listStockLocations });
  const motivos = useQuery({ queryKey: ["stock-reasons"], queryFn: listStockReasons });

  const opcoesLocais = (locais.data ?? []).map((l) => ({
    value: l.id,
    label: l.name,
    hint: l.code,
  }));
  const opcoesMotivos = (motivos.data ?? [])
    .filter((m) => m.kind === kind)
    .map((m) => ({ value: m.code, label: m.label }));

  const precisaOrigem = kind === "saida" || kind === "transferencia";
  const precisaDestino = kind !== "saida";
  /** Ajuste aceita correção para menos; contagem aceita zero. */
  const aceitaNegativo = kind === "ajuste";
  const aceitaZero = kind === "inventario";
  const motivoObrigatorio = kind === "ajuste" || kind === "saida" || kind === "inventario";
  const notaObrigatoria = kind === "ajuste" || MOTIVO_ESCRITO.includes(motivo);
  const referenciaObrigatoria = MOTIVO_COM_DOCUMENTO.includes(motivo);

  /** Uma chave por abertura do formulário: reenvio não duplica o lançamento. */
  const chave = React.useRef(crypto.randomUUID());
  React.useEffect(() => {
    if (open) {
      chave.current = crypto.randomUUID();
      setConfirmar(false);
    }
  }, [open]);

  function limpar() {
    setVariant(null);
    setQuantidade("");
    setMotivo("");
    setCusto("");
    setReferencia("");
    setNota("");
    setOrigem("");
    setDestino("");
    setConfirmar(false);
  }

  /** Trocar o tipo apaga origem, destino e todo campo incompatível. */
  function trocarTipo(novo: StockMoveKind) {
    setKind(novo);
    setMotivo("");
    setOrigem("");
    setDestino("");
    setQuantidade("");
    setCusto("");
    setConfirmar(false);
  }

  function validar(): string | null {
    if (!variant) return "Escolha a peça.";
    const bruto = quantidade.trim();
    const qtd = Number(bruto);
    if (bruto === "" || Number.isNaN(qtd) || !Number.isInteger(qtd))
      return "Informe uma quantidade em número inteiro.";
    if (qtd === 0 && !aceitaZero) return "A quantidade precisa ser diferente de zero.";
    if (qtd < 0 && !aceitaNegativo) return "Quantidade negativa só é permitida em ajuste.";
    if (precisaOrigem && !origem) return "Informe o local de origem.";
    if (precisaDestino && !destino) return "Informe o local de destino.";
    if (origem && destino && origem === destino)
      return "Origem e destino precisam ser locais diferentes.";
    if (motivoObrigatorio && !motivo) return "Escolha o motivo desta movimentação.";
    if (notaObrigatoria && !nota.trim()) return "Escreva a justificativa desta operação.";
    if (referenciaObrigatoria && !referencia.trim())
      return "Informe a referência do recebimento (nota, pedido ou protocolo).";
    if (podeCusto && custo.trim() && (parseCentavos(custo) ?? 0) < 0)
      return "O custo unitário não pode ser negativo.";
    return null;
  }

  const salvar = useMutation({
    mutationFn: async () => {
      const erro = validar();
      if (erro) throw new Error(erro);
      return registerMovement({
        kind,
        variantId: (variant as VariantOption).id,
        quantity: Number(quantidade),
        fromLocationId: precisaOrigem ? origem : null,
        toLocationId: precisaDestino ? destino : null,
        reasonCode: motivo || null,
        // sem a capacidade, o custo nem sai do navegador
        unitCostCents: podeCusto && custo ? parseCentavos(custo) : null,
        reference: referencia || null,
        note: nota || null,
        idempotencyKey: chave.current,
      });
    },
    onSuccess: () => {
      toast.success(`${MOVE_LABEL[kind]} registrada.`);
      qc.invalidateQueries({ queryKey: ["stock"] });
      chave.current = crypto.randomUUID();
      limpar();
      onOpenChange(false);
    },
    onError: (e) => {
      setConfirmar(false);
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar.");
    },
  });

  const semLocais = !locais.isLoading && (locais.data ?? []).length === 0;
  const nomeLocal = (id: string) => opcoesLocais.find((l) => l.value === id)?.label ?? "—";
  const nomeMotivo = (code: string) =>
    opcoesMotivos.find((m) => m.value === code)?.label ?? code ?? "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-scope max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Nova movimentação</DialogTitle>
          <DialogDescription>
            A movimentação é permanente: nada é apagado, correções entram como novo lançamento.
          </DialogDescription>
        </DialogHeader>

        {semLocais ? (
          <p className="rounded-[10px] border border-line bg-surface-muted px-4 py-4 text-sm font-medium text-ledger-muted">
            Nenhum local ativo cadastrado. Cadastre depósitos, lojas ou maletas em Cadastros ›
            Locais antes de movimentar o estoque.
          </p>
        ) : confirmar ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-ledger-muted">
              Confira antes de gravar. Depois de registrada, a movimentação não pode ser
              alterada nem apagada.
            </p>
            <dl className="rounded-[10px] border border-line divide-y divide-line">
              {[
                ["Tipo", MOVE_LABEL[kind]],
                ["Peça", `${variant?.produto ?? ""} · ${variant?.label ?? ""}`],
                ["Quantidade", quantidade],
                ...(precisaOrigem ? [["Origem", nomeLocal(origem)]] : []),
                ...(precisaDestino ? [["Destino", nomeLocal(destino)]] : []),
                ...(motivo ? [["Motivo", nomeMotivo(motivo)]] : []),
                ...(referencia ? [["Referência", referencia]] : []),
                ...(nota ? [["Justificativa", nota]] : []),
                ...(podeCusto && custo
                  ? [["Custo unitário", formatBRLFromCents(parseCentavos(custo) ?? 0)]]
                  : []),
              ].map(([r, v]) => (
                <div key={r as string} className="flex justify-between gap-6 px-4 py-2.5 text-sm">
                  <dt className="font-semibold text-ledger-muted">{r}</dt>
                  <dd className="text-right font-medium text-ledger-text">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setConfirmar(false)} className="admin-btn">
                Voltar e corrigir
              </button>
              <button
                type="button"
                disabled={salvar.isPending}
                onClick={() => salvar.mutate()}
                className="admin-btn-primary"
              >
                {salvar.isPending ? "Registrando…" : "Confirmar e registrar"}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const erro = validar();
              if (erro) {
                toast.error(erro);
                return;
              }
              setConfirmar(true);
            }}
          >
            <Campo label="Tipo de movimentação">
              <SmartSelect
                options={TIPOS}
                value={kind}
                onChange={(v) => trocarTipo(v as StockMoveKind)}
              />
            </Campo>

            <Campo label="Peça">
              <VariantPicker value={variant} onChange={setVariant} />
            </Campo>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                label={
                  kind === "inventario"
                    ? "Quantidade contada"
                    : aceitaNegativo
                      ? "Quantidade (use - para corrigir para menos)"
                      : "Quantidade"
                }
              >
                <input
                  inputMode={aceitaNegativo ? "text" : "numeric"}
                  value={quantidade}
                  onChange={(e) =>
                    setQuantidade(
                      aceitaNegativo
                        ? e.target.value.replace(/[^\d-]/g, "").replace(/(?!^)-/g, "")
                        : e.target.value.replace(/\D/g, ""),
                    )
                  }
                  placeholder="0"
                  className={inputCls}
                />
              </Campo>
              <Campo label={motivoObrigatorio ? "Motivo" : "Motivo (opcional)"}>
                <SmartSelect
                  options={opcoesMotivos}
                  value={motivo}
                  onChange={setMotivo}
                  placeholder="Selecionar motivo"
                  emptyLabel="Sem motivos para este tipo"
                />
              </Campo>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {precisaOrigem && (
                <Campo label="Local de origem">
                  <SmartSelect
                    options={opcoesLocais}
                    value={origem}
                    onChange={setOrigem}
                    placeholder="Selecionar local"
                  />
                </Campo>
              )}
              {precisaDestino && (
                <Campo label={kind === "transferencia" ? "Local de destino" : "Local"}>
                  <SmartSelect
                    options={opcoesLocais}
                    value={destino}
                    onChange={setDestino}
                    placeholder="Selecionar local"
                  />
                </Campo>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* O campo de custo nem existe na tela sem a capacidade. */}
              {podeCusto && (
                <Campo label="Custo unitário (opcional)">
                  <input
                    value={custo}
                    onChange={(e) => setCusto(e.target.value)}
                    placeholder="0,00"
                    className={inputCls}
                  />
                </Campo>
              )}
              <Campo
                label={referenciaObrigatoria ? "Referência do documento" : "Referência (opcional)"}
              >
                <input
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  placeholder="Nota, pedido, protocolo"
                  className={inputCls}
                />
              </Campo>
            </div>

            <Campo label={notaObrigatoria ? "Justificativa" : "Observação (opcional)"}>
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={2}
                placeholder={
                  notaObrigatoria ? "Explique o que aconteceu com estas peças" : undefined
                }
                className="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
              />
            </Campo>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => onOpenChange(false)} className="admin-btn">
                Cancelar
              </button>
              <button type="submit" className="admin-btn-primary">
                Revisar e confirmar
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
