import * as React from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { buscarContrapartes, fetchFinAccounts, reaisParaCentavos } from "@/lib/financeiro";
import { criarCartao } from "@/lib/financeiro-cartao";

export const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

export function Campo({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">{label}</span>
      {children}
      {help && <span className="block text-xs text-ledger-muted">{help}</span>}
    </label>
  );
}

const DIAS = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `Dia ${i + 1}` }));
const BANDEIRAS = ["Visa", "Mastercard", "Elo", "American Express", "Hipercard"].map((b) => ({ value: b, label: b }));

/** Cadastro de cartão de crédito: a conta e a configuração da fatura nascem juntas. */
export function NovoCartaoSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [v, setV] = React.useState<Record<string, string>>({});
  const [termo, setTermo] = React.useState("");
  const set = (k: string) => (x: string) => setV((o) => ({ ...o, [k]: x }));
  const contas = useQuery({ queryKey: ["fin-accounts"], queryFn: fetchFinAccounts });
  const pessoas = useQuery({ queryKey: ["contrapartes", termo], queryFn: () => buscarContrapartes(termo), enabled: open });

  React.useEffect(() => {
    if (open) setV({});
  }, [open]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!v["nome"]?.trim()) throw new Error("Informe o nome do cartão.");
      if (!v["dia_vencimento"]) throw new Error("Escolha o dia de vencimento da fatura.");
      const limite = v["limite"]?.trim() ? reaisParaCentavos(v["limite"]) : null;
      return criarCartao({ ...v, limite_cents: limite });
    },
    onSuccess: (id) => {
      toast.success("Cartão cadastrado.");
      void qc.invalidateQueries({ queryKey: ["fin-accounts"] });
      onOpenChange(false);
      void navigate({ to: "/admin/financeiro/contas/$id", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bancos = (contas.data ?? []).filter((c) => c.kind !== "cartao_credito" && c.is_active);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Novo cartão de crédito</SheetTitle>
          <SheetDescription>
            Os gastos entram no resultado pela data de cada compra. No fechamento, a fatura vira uma única conta a pagar.
          </SheetDescription>
        </SheetHeader>
        <form
          className="mt-6 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            salvar.mutate();
          }}
        >
          <div className="sm:col-span-2">
            <Campo label="Nome do cartão *">
              <input aria-label="Nome do cartão" className={inputCls} value={v["nome"] ?? ""} onChange={(e) => set("nome")(e.target.value)} placeholder="Ex.: Itaú Platinum Daniel" />
            </Campo>
          </div>
          <Campo label="Banco">
            <input aria-label="Banco" className={inputCls} value={v["banco"] ?? ""} onChange={(e) => set("banco")(e.target.value)} />
          </Campo>
          <Campo label="Final do cartão">
            <input aria-label="Final do cartão" className={inputCls} inputMode="numeric" maxLength={4} value={v["final_cartao"] ?? ""} onChange={(e) => set("final_cartao")(e.target.value.replace(/\D/g, ""))} placeholder="1234" />
          </Campo>
          <Campo label="Bandeira">
            <SmartSelect options={BANDEIRAS} value={v["bandeira"] ?? ""} onChange={set("bandeira")} placeholder="Escolher" />
          </Campo>
          <Campo label="Limite (R$)">
            <input aria-label="Limite" className={inputCls} inputMode="decimal" value={v["limite"] ?? ""} onChange={(e) => set("limite")(e.target.value)} placeholder="0,00" />
          </Campo>
          <Campo label="Dia de fechamento">
            <SmartSelect options={DIAS} value={v["dia_fechamento"] ?? ""} onChange={set("dia_fechamento")} placeholder="Escolher" />
          </Campo>
          <Campo label="Dia de vencimento *">
            <SmartSelect options={DIAS} value={v["dia_vencimento"] ?? ""} onChange={set("dia_vencimento")} placeholder="Escolher" />
          </Campo>
          <div className="sm:col-span-2">
            <Campo label="Conta que paga a fatura" help="Sugerida ao gerar a conta a pagar; pode ser trocada no fechamento.">
              <SmartSelect options={bancos.map((c) => ({ value: c.id, label: c.nome }))} value={v["conta_pagamento_id"] ?? ""} onChange={set("conta_pagamento_id")} placeholder="Escolher conta" />
            </Campo>
          </div>
          <div className="sm:col-span-2">
            <Campo label="Quem recebe o pagamento (banco emissor)" help="Cadastro da Central de Cadastros usado como favorecido da conta a pagar.">
              <SmartSelect
                options={(pessoas.data ?? []).map((p) => ({ value: p.id, label: p.nome, hint: p.hint }))}
                value={v["emissor_party_id"] ?? ""}
                onChange={set("emissor_party_id")}
                onSearch={setTermo}
                loading={pessoas.isFetching}
                placeholder="Buscar cadastro"
              />
            </Campo>
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="admin-btn" onClick={() => onOpenChange(false)}>Cancelar</button>
            <button type="submit" className="admin-btn-primary" disabled={salvar.isPending}>
              {salvar.isPending ? "Gravando…" : "Cadastrar cartão"}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
