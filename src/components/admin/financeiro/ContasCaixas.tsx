import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  StatusBadge,
  formatBRLFromCents,
} from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { RecordSheet, type RecordValues } from "@/components/admin/RecordSheet";
import { useCapabilities } from "@/lib/capabilities";
import {
  criarConta,
  fetchFinAccounts,
  reaisParaCentavos,
  transferirEntreContas,
} from "@/lib/financeiro";

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

const TIPOS = [
  { value: "conta_corrente", label: "Conta corrente" },
  { value: "poupanca", label: "Poupança" },
  { value: "caixa", label: "Caixa" },
  { value: "carteira", label: "Carteira" },
  { value: "compensacao", label: "Conta de compensação" },
  { value: "investimento", label: "Investimento" },
];

/** Contas, caixas e transferências internas. Saldo sempre vem do razão. */
export function ContasCaixas() {
  const qc = useQueryClient();
  const caps = useCapabilities();
  const podeGerir = caps.includes("finance.bank.manage");
  const [nova, setNova] = React.useState(false);
  const [origem, setOrigem] = React.useState("");
  const [destino, setDestino] = React.useState("");
  const [valor, setValor] = React.useState("");
  const [motivo, setMotivo] = React.useState("");

  const contas = useQuery({ queryKey: ["fin-accounts"], queryFn: fetchFinAccounts });

  const salvar = useMutation({
    mutationFn: async (v: RecordValues) => {
      const nome = String(v["nome"] ?? "").trim();
      if (!nome) throw new Error("Informe o nome da conta.");
      const saldo = reaisParaCentavos(String(v["saldo_inicial"] ?? "0")) ?? 0;
      return criarConta({
        nome,
        kind: String(v["kind"] ?? "conta_corrente"),
        banco: String(v["banco"] ?? "").trim(),
        saldo_inicial_cents: saldo,
      });
    },
    onSuccess: () => {
      toast.success("Conta cadastrada.");
      void qc.invalidateQueries({ queryKey: ["fin-accounts"] });
      void qc.invalidateQueries({ queryKey: ["fin-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transferir = useMutation({
    mutationFn: async () => {
      if (!origem || !destino) throw new Error("Escolha a conta de origem e a de destino.");
      if (origem === destino) throw new Error("Origem e destino devem ser diferentes.");
      const cents = reaisParaCentavos(valor);
      if (!cents || cents <= 0) throw new Error("Informe um valor maior que zero.");
      return transferirEntreContas({
        from_account_id: origem,
        to_account_id: destino,
        valor_cents: cents,
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
        idempotency_key: crypto.randomUUID(),
      });
    },
    onSuccess: () => {
      toast.success("Transferência registrada nas duas contas.");
      setValor("");
      setMotivo("");
      void qc.invalidateQueries({ queryKey: ["fin-accounts"] });
      void qc.invalidateQueries({ queryKey: ["fin-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const opcoes = (contas.data ?? []).map((c) => ({ value: c.id, label: c.nome }));

  return (
    <div className="space-y-6">
      <Panel
        title="Contas e caixas"
        action={
          podeGerir ? (
            <button type="button" className="admin-btn admin-btn--primary" onClick={() => setNova(true)}>
              <Plus aria-hidden className="size-4" /> Nova conta
            </button>
          ) : undefined
        }
      >
        {contas.isLoading && <Skeleton className="h-24 w-full" />}
        {contas.error && <ErrorState message="Não foi possível carregar as contas." />}
        {contas.data && contas.data.length === 0 && (
          <EmptyState
            title="Nenhuma conta cadastrada"
            description="Cadastre a primeira conta ou caixa para registrar pagamentos e recebimentos."
          />
        )}
        {contas.data && contas.data.length > 0 && (
          <ul className="divide-y divide-line-soft">
            {contas.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ledger-text">{c.nome}</p>
                  <p className="text-xs text-ledger-muted">
                    {c.banco ? `${c.banco} · ` : ""}
                    {c.ultimo_movimento
                      ? `último movimento em ${new Intl.DateTimeFormat("pt-BR").format(new Date(`${c.ultimo_movimento}T12:00:00`))}`
                      : "sem movimentos"}
                  </p>
                </div>
                <span className="flex items-center gap-3">
                  <StatusBadge tone={c.is_active ? "success" : "neutral"}>
                    {c.is_active ? "Ativa" : "Inativa"}
                  </StatusBadge>
                  <span className="text-sm font-semibold tabular-nums text-ledger-text">
                    {formatBRLFromCents(c.saldo_cents)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {podeGerir && (contas.data?.length ?? 0) > 1 && (
        <Panel title="Transferência interna">
          <div className="grid gap-3 sm:grid-cols-2">
            <SmartSelect options={opcoes} value={origem} onChange={setOrigem} placeholder="De" />
            <SmartSelect options={opcoes} value={destino} onChange={setDestino} placeholder="Para" />
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              placeholder="Valor 0,00"
              className={inputCls}
            />
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo (opcional)"
              className={inputCls}
            />
          </div>
          <button
            type="button"
            className="admin-btn admin-btn--primary mt-3"
            disabled={transferir.isPending}
            onClick={() => transferir.mutate()}
          >
            {transferir.isPending ? "Gravando…" : "Transferir"}
          </button>
        </Panel>
      )}

      <RecordSheet
        open={nova}
        onOpenChange={setNova}
        title="Nova conta ou caixa"
        description="O saldo inicial é um marco auditado, com data de corte na criação."
        fields={[
          { name: "nome", label: "Nome", type: "text", required: true },
          { name: "kind", label: "Tipo", type: "select", options: TIPOS, required: true },
          { name: "banco", label: "Banco", type: "text" },
          { name: "saldo_inicial", label: "Saldo inicial (R$)", type: "text" },
        ]}
        initial={{ kind: "conta_corrente", saldo_inicial: "0,00" }}
        onSubmit={async (v) => {
          await salvar.mutateAsync(v);
        }}
      />
    </div>
  );
}
