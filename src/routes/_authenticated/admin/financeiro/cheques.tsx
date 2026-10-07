import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search } from "lucide-react";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { EmptyState, ErrorState, Panel, Skeleton, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { useCapabilities } from "@/lib/capabilities";
import { buscarContrapartes, fetchFinAccounts, reaisParaCentavos } from "@/lib/financeiro";
import {
  STATUS_CHEQUE,
  fetchCheques,
  mudarCheque,
  registrarCheque,
  type Cheque,
  type StatusCheque,
} from "@/lib/financeiro-cheques";

export const Route = createFileRoute("/_authenticated/admin/financeiro/cheques")({
  component: () => (
    <AreaFinanceiraGuard capacidade="finance.bank.view">
      <Cheques />
    </AreaFinanceiraGuard>
  ),
  head: () => ({ meta: [{ title: "Carteira de cheques — Financeiro Lardan" }] }),
});

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";
const btn2 =
  "inline-flex h-9 items-center rounded-[10px] border border-line bg-surface px-3 text-xs font-semibold text-ledger-text hover:bg-cream-2";
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dataBR = (d: string) => new Intl.DateTimeFormat("pt-BR").format(new Date(`${d}T12:00:00`));
const TOM: Record<StatusCheque, "success" | "neutral" | "warning" | "danger"> = {
  em_maos: "warning",
  repassado: "neutral",
  depositado: "neutral",
  compensado: "success",
  devolvido: "danger",
  cancelado: "neutral",
};
const FILTROS: (StatusCheque | "")[] = ["", "em_maos", "repassado", "depositado", "compensado", "devolvido"];

function usePessoas() {
  const [termo, setTermo] = React.useState("");
  const q = useQuery({ queryKey: ["contrapartes", termo], queryFn: () => buscarContrapartes(termo) });
  return { setTermo, loading: q.isFetching, options: (q.data ?? []).map((p) => ({ value: p.id, label: p.nome })) };
}

function Cheques() {
  const podeGerir = useCapabilities().includes("finance.bank.manage");
  const [status, setStatus] = React.useState<StatusCheque | "">("em_maos");
  const [busca, setBusca] = React.useState("");
  const [q, setQ] = React.useState("");
  const [novo, setNovo] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setQ(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);
  const lista = useQuery({
    queryKey: ["fin-cheques", status, q],
    queryFn: () => fetchCheques(status || null, q || null),
  });
  const r = lista.data?.resumo ?? {};

  return (
    <div className="space-y-6">
      <Panel
        title="Carteira de cheques"
        action={
          podeGerir ? (
            <button type="button" className="admin-btn-primary" onClick={() => setNovo((v) => !v)}>
              <Plus aria-hidden className="size-4" /> Receber cheque
            </button>
          ) : undefined
        }
      >
        <p className="mb-4 text-sm text-ledger-muted">
          Cheque não é saldo de banco: fica em mãos até ser repassado ou depositado. O dinheiro só entra no banco quando
          compensar e for conciliado no extrato.
        </p>
        <div className="grid gap-3 sm:grid-cols-5">
          {(["em_maos", "repassado", "depositado", "compensado", "devolvido"] as StatusCheque[]).map((s) => (
            <div key={s} className="rounded-[12px] border border-line-soft bg-cream-2 p-3">
              <p className="text-xs text-ledger-muted">{STATUS_CHEQUE[s]}</p>
              <p className="text-lg font-bold tabular-nums">{formatBRLFromCents(r[s]?.total_cents ?? 0)}</p>
              <p className="text-xs text-ledger-muted">{r[s]?.qtd ?? 0} cheque(s)</p>
            </div>
          ))}
        </div>
      </Panel>

      {novo && podeGerir && <NovoCheque onDone={() => setNovo(false)} />}

      <Panel>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {FILTROS.map((s) => (
            <button
              key={s || "todos"}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold ${
                status === s ? "border-champagne bg-surface shadow-sm" : "border-line-soft bg-cream-2 text-ledger-muted"
              }`}
            >
              {s ? STATUS_CHEQUE[s] : "Todos"}
            </button>
          ))}
          <label className="relative ml-auto w-full sm:w-72">
            <Search aria-hidden className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ledger-muted" />
            <input className={`${inputCls} pl-9`} placeholder="Número, emitente ou para quem" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
        </div>
        {lista.isLoading && <Skeleton className="h-24 w-full" />}
        {lista.error && <ErrorState message={(lista.error as Error).message} />}
        {lista.data && lista.data.linhas.length === 0 && (
          <EmptyState title="Sem cheques" description="Nenhum cheque nesta situação." />
        )}
        <ul className="divide-y divide-line-soft">
          {lista.data?.linhas.map((c) => <LinhaCheque key={c.id} c={c} podeGerir={podeGerir} />)}
        </ul>
      </Panel>
    </div>
  );
}

function NovoCheque({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const pessoas = usePessoas();
  const [f, setF] = React.useState<Record<string, string>>({});
  const [bomPara, setBomPara] = React.useState<Date | undefined>();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const salvar = useMutation({
    mutationFn: () =>
      registrarCheque({
        ...f,
        valor_cents: reaisParaCentavos(f["valor"] ?? "") ?? 0,
        bom_para: bomPara ? iso(bomPara) : "",
      }),
    onSuccess: () => {
      toast.success("Cheque registrado em mãos.");
      void qc.invalidateQueries({ queryKey: ["fin-cheques"] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Panel title="Receber cheque">
      <div className="grid gap-3 sm:grid-cols-3">
        <input className={inputCls} placeholder="Número do cheque *" onChange={set("numero")} />
        <input className={inputCls} placeholder="Banco" onChange={set("banco")} />
        <div className="grid grid-cols-2 gap-3">
          <input className={inputCls} placeholder="Agência" onChange={set("agencia")} />
          <input className={inputCls} placeholder="Conta" onChange={set("conta")} />
        </div>
        <input className={inputCls} placeholder="Emitente (nome no cheque) *" onChange={set("emitente_nome")} />
        <input className={inputCls} inputMode="numeric" maxLength={18} placeholder="CPF/CNPJ do emitente" onChange={set("emitente_doc")} />
        <SmartSelect
          options={pessoas.options}
          value={f["recebido_de_party_id"] ?? ""}
          onChange={(v) => setF((p) => ({ ...p, recebido_de_party_id: v }))}
          onSearch={pessoas.setTermo}
          loading={pessoas.loading}
          placeholder="Recebido de (cadastro)"
        />
        <input className={inputCls} inputMode="decimal" placeholder="Valor 0,00 *" onChange={set("valor")} />
        <DateField value={bomPara} onChange={setBomPara} placeholder="Bom para *" />
        <input className={inputCls} placeholder="Observação" onChange={set("observacao")} />
      </div>
      <button type="button" className="admin-btn-primary mt-3" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
        {salvar.isPending ? "Gravando…" : "Registrar em mãos"}
      </button>
    </Panel>
  );
}

function LinhaCheque({ c, podeGerir }: { c: Cheque; podeGerir: boolean }) {
  const qc = useQueryClient();
  const [acao, setAcao] = React.useState<StatusCheque | null>(null);
  const [party, setParty] = React.useState("");
  const [nome, setNome] = React.useState("");
  const [conta, setConta] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const pessoas = usePessoas();
  const contas = useQuery({ queryKey: ["fin-accounts"], queryFn: fetchFinAccounts, enabled: acao === "depositado" });
  const mudar = useMutation({
    mutationFn: (para: StatusCheque) =>
      mudarCheque(c.id, para, { party_id: party, nome, account_id: conta, motivo }),
    onSuccess: () => {
      toast.success("Cheque atualizado.");
      setAcao(null);
      void qc.invalidateQueries({ queryKey: ["fin-cheques"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const proximas: Partial<Record<StatusCheque, StatusCheque[]>> = {
    em_maos: ["repassado", "depositado", "devolvido", "cancelado"],
    depositado: ["compensado", "devolvido"],
    repassado: ["devolvido"],
    devolvido: ["em_maos"],
  };
  const rotulo: Record<string, string> = {
    repassado: "Repassar",
    depositado: "Depositar",
    compensado: "Compensou",
    devolvido: "Devolvido",
    cancelado: "Cancelar",
    em_maos: "Voltou para mãos",
  };
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ledger-text">
            Nº {c.numero} · {c.emitente_nome}
            {c.emitente_doc ? <span className="ml-1 text-xs text-ledger-muted">{c.emitente_doc}</span> : null}
          </p>
          <p className="text-xs text-ledger-muted">
            {[c.banco, c.agencia && `Ag. ${c.agencia}`, c.conta && `C/C ${c.conta}`].filter(Boolean).join(" · ")}
            {` · bom para ${dataBR(c.bom_para)} · recebido em ${dataBR(c.recebido_em)}`}
            {c.recebido_de ? ` de ${c.recebido_de}` : ""}
            {c.repassado_para ? ` · passado para ${c.repassado_para}` : ""}
            {c.conta_deposito ? ` · depositado em ${c.conta_deposito}` : ""}
          </p>
        </div>
        <span className="flex items-center gap-3">
          <StatusBadge tone={TOM[c.status]}>{STATUS_CHEQUE[c.status]}</StatusBadge>
          <span className="font-semibold tabular-nums">{formatBRLFromCents(c.valor_cents)}</span>
        </span>
      </div>
      {podeGerir && (proximas[c.status]?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {proximas[c.status]!.map((p) => (
            <button key={p} type="button" className={btn2} onClick={() => setAcao(acao === p ? null : p)}>
              {rotulo[p]}
            </button>
          ))}
        </div>
      )}
      {acao && (
        <div className="mt-3 grid gap-3 rounded-[12px] border border-line-soft bg-cream-2 p-3 sm:grid-cols-3">
          {acao === "repassado" && (
            <>
              <SmartSelect options={pessoas.options} value={party} onChange={setParty} onSearch={pessoas.setTermo} loading={pessoas.loading} placeholder="Para quem (cadastro)" />
              <input className={inputCls} placeholder="ou nome, se não tiver cadastro" value={nome} onChange={(e) => setNome(e.target.value)} />
            </>
          )}
          {acao === "depositado" && (
            <SmartSelect
              options={(contas.data ?? []).filter((a) => a.is_active).map((a) => ({ value: a.id, label: a.nome }))}
              value={conta}
              onChange={setConta}
              placeholder="Conta do depósito"
            />
          )}
          <input className={inputCls} placeholder={acao === "devolvido" || acao === "cancelado" ? "Motivo (obrigatório)" : "Observação"} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <button type="button" className="admin-btn-primary" disabled={mudar.isPending} onClick={() => mudar.mutate(acao)}>
            Confirmar
          </button>
        </div>
      )}
    </li>
  );
}
