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
import {
  MOVE_LABEL,
  listStockLocations,
  listStockReasons,
  registerMovement,
  type StockMoveKind,
} from "@/lib/stock";
import { parseCentavos } from "@/lib/catalog";

const TIPOS: { value: StockMoveKind; label: string; hint: string }[] = [
  { value: "entrada", label: "Entrada", hint: "recebimento, devolução, retorno" },
  { value: "saida", label: "Saída", hint: "venda, envio, perda" },
  { value: "transferencia", label: "Transferência", hint: "entre dois locais" },
  { value: "ajuste", label: "Ajuste", hint: "correção pontual" },
  { value: "inventario", label: "Inventário", hint: "define a quantidade contada" },
];

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
  const [kind, setKind] = React.useState<StockMoveKind>("entrada");
  const [variant, setVariant] = React.useState<VariantOption | null>(null);
  const [quantidade, setQuantidade] = React.useState("");
  const [origem, setOrigem] = React.useState("");
  const [destino, setDestino] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [custo, setCusto] = React.useState("");
  const [referencia, setReferencia] = React.useState("");
  const [nota, setNota] = React.useState("");

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
  /** Ajuste aceita correção para menos; inventário aceita contagem zero. */
  const aceitaNegativo = kind === "ajuste";
  const aceitaZero = kind === "inventario";
  const motivoObrigatorio = kind === "ajuste" || kind === "saida" || kind === "inventario";

  /** Uma chave por abertura do formulário: reenvio não duplica o lançamento. */
  const chave = React.useRef(crypto.randomUUID());
  React.useEffect(() => {
    if (open) chave.current = crypto.randomUUID();
  }, [open]);

  function limpar() {
    setVariant(null);
    setQuantidade("");
    setMotivo("");
    setCusto("");
    setReferencia("");
    setNota("");
  }

  const salvar = useMutation({
    mutationFn: async () => {
      if (!variant) throw new Error("Escolha a peça.");
      const bruto = quantidade.trim();
      const qtd = Number(bruto);
      if (bruto === "" || Number.isNaN(qtd) || !Number.isInteger(qtd))
        throw new Error("Informe uma quantidade em número inteiro.");
      if (qtd === 0 && !aceitaZero)
        throw new Error("A quantidade precisa ser diferente de zero.");
      if (qtd < 0 && !aceitaNegativo)
        throw new Error("Quantidade negativa só é permitida em ajuste.");
      if (precisaOrigem && !origem) throw new Error("Informe o local de origem.");
      if (precisaDestino && !destino) throw new Error("Informe o local de destino.");
      if (origem && destino && origem === destino)
        throw new Error("Origem e destino precisam ser locais diferentes.");
      if (motivoObrigatorio && !motivo)
        throw new Error("Escolha o motivo desta movimentação.");
      return registerMovement({
        kind,
        variantId: variant.id,
        quantity: qtd,
        fromLocationId: precisaOrigem ? origem : null,
        toLocationId: precisaDestino ? destino : null,
        reasonCode: motivo || null,
        unitCostCents: custo ? parseCentavos(custo) : null,
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
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível registrar."),
  });


  const semLocais = !locais.isLoading && (locais.data ?? []).length === 0;

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
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              salvar.mutate();
            }}
          >
            <Campo label="Tipo de movimentação">
              <SmartSelect
                options={TIPOS}
                value={kind}
                onChange={(v) => {
                  setKind(v as StockMoveKind);
                  setMotivo("");
                }}
              />
            </Campo>

            <Campo label="Peça">
              <VariantPicker value={variant} onChange={setVariant} />
            </Campo>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label={kind === "inventario" ? "Quantidade contada" : "Quantidade"}>
                <input
                  inputMode="numeric"
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                  className={inputCls}
                />
              </Campo>
              <Campo label="Motivo">
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
              <Campo label="Custo unitário (opcional)">
                <input
                  value={custo}
                  onChange={(e) => setCusto(e.target.value)}
                  placeholder="0,00"
                  className={inputCls}
                />
              </Campo>
              <Campo label="Referência (opcional)">
                <input
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  placeholder="Nota, pedido, protocolo"
                  className={inputCls}
                />
              </Campo>
            </div>

            <Campo label="Observação (opcional)">
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={2}
                className="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
              />
            </Campo>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => onOpenChange(false)} className="admin-btn">
                Cancelar
              </button>
              <button type="submit" disabled={salvar.isPending} className="admin-btn-primary">
                {salvar.isPending ? "Registrando…" : "Registrar movimentação"}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
