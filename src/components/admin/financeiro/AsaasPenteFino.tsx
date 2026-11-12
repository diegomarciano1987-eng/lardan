import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Panel, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import {
  ROTULO_CATEGORIA, cancelarFantasma, desfazerFantasma, penteFino, resolverAlerta, type AlertaAsaas,
} from "@/lib/asaas-automatico";

const data = (d?: string | null) => (d ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${d.slice(0, 10)}T12:00:00`)) : "—");
const ROTULO_TIPO: Record<AlertaAsaas["tipo"], string> = {
  cobranca_excluida: "Excluída no Asaas",
  valor_alterado: "Valor mudou no Asaas",
  vencimento_alterado: "Vencimento mudou no Asaas",
};

function Motivo({ rotulo, pendente, onConfirmar }: { rotulo: string; pendente: boolean; onConfirmar: (m: string) => void }) {
  const [motivo, setMotivo] = React.useState("");
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Motivo (obrigatório)"
        className="h-10 min-w-[16rem] flex-1 rounded-[10px] border border-line bg-surface px-3 text-sm text-ledger-text outline-none focus:border-champagne"
      />
      <button type="button" className="admin-btn-primary h-10" disabled={motivo.trim().length < 5 || pendente} onClick={() => onConfirmar(motivo.trim())}>
        {pendente ? "Gravando…" : rotulo}
      </button>
    </div>
  );
}

function LinhaAlerta({ a, onFeito }: { a: AlertaAsaas; onFeito: () => void }) {
  const [aberto, setAberto] = React.useState<"" | "cancelar" | "resolver">("");
  const cancelar = useMutation({
    mutationFn: (m: string) => cancelarFantasma(a.installment_id!, m),
    onSuccess: (r) => { toast.success(`Título ${r.numero} cancelado no Lardan. Dá para desfazer abaixo.`); onFeito(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const resolver = useMutation({
    mutationFn: (m: string) => resolverAlerta(a.id, m),
    onSuccess: () => { toast.success("Alerta marcado como resolvido."); onFeito(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mudou = a.tipo === "valor_alterado"
    ? `${formatBRLFromCents(a.antes.valor_cents ?? 0)} → ${formatBRLFromCents(a.depois.valor_cents ?? 0)}`
    : a.tipo === "vencimento_alterado" ? `${data(a.antes.vencimento)} → ${data(a.depois.vencimento)}` : `vencia ${data(a.antes.vencimento)}`;
  return (
    <li className="border-b border-line-soft py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ledger-text">
            {a.pessoa ?? "Sem cadastro"}
            {a.pessoa_codigo ? <span className="ml-1 font-normal text-ledger-muted">· Cód. {a.pessoa_codigo}</span> : null}
          </p>
          <p className="text-xs text-ledger-muted">
            {a.pay}{a.titulo_numero ? ` · título ${a.titulo_numero}` : ""} · {mudou}
            {a.judicial ? " · cliente com processo judicial" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={a.tipo === "cobranca_excluida" ? "warning" : "neutral"}>{ROTULO_TIPO[a.tipo]}</StatusBadge>
          <span className="text-sm font-bold tabular-nums text-ledger-text">{formatBRLFromCents(a.saldo_cents ?? 0)}</span>
          {a.tipo === "cobranca_excluida" && a.installment_id ? (
            <button type="button" className="admin-btn h-9" onClick={() => setAberto((v) => (v === "cancelar" ? "" : "cancelar"))}>Cancelar no Lardan</button>
          ) : null}
          <button type="button" className="admin-btn h-9" onClick={() => setAberto((v) => (v === "resolver" ? "" : "resolver"))}>Já resolvi</button>
        </div>
      </div>
      {aberto === "cancelar" ? <Motivo rotulo="Confirmar cancelamento" pendente={cancelar.isPending} onConfirmar={(m) => cancelar.mutate(m)} /> : null}
      {aberto === "resolver" ? <Motivo rotulo="Marcar resolvido" pendente={resolver.isPending} onConfirmar={(m) => resolver.mutate(m)} /> : null}
    </li>
  );
}

function LinhaFantasma({ f, onFeito }: { f: { id: string; titulo_numero: string; pessoa: string | null; pessoa_codigo: string | null; saldo_cents: number; motivo: string; criado_em: string }; onFeito: () => void }) {
  const [aberto, setAberto] = React.useState(false);
  const m = useMutation({
    mutationFn: (mot: string) => desfazerFantasma(f.id, mot),
    onSuccess: () => { toast.success(`Título ${f.titulo_numero} reativado.`); onFeito(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <li className="border-b border-line-soft py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ledger-text">
            {f.pessoa ?? "Sem cadastro"}{f.pessoa_codigo ? <span className="ml-1 font-normal text-ledger-muted">· Cód. {f.pessoa_codigo}</span> : null}
          </p>
          <p className="text-xs text-ledger-muted">título {f.titulo_numero} · {data(f.criado_em)} · {f.motivo}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tabular-nums text-ledger-text">{formatBRLFromCents(f.saldo_cents)}</span>
          <button type="button" className="admin-btn h-9" onClick={() => setAberto((v) => !v)}>
            <Undo2 aria-hidden className="mr-1 inline size-4" /> Desfazer
          </button>
        </div>
      </div>
      {aberto ? <Motivo rotulo="Reativar título" pendente={m.isPending} onConfirmar={(mot) => m.mutate(mot)} /> : null}
    </li>
  );
}

/** 0297 — o que está diferente entre o Asaas e o Lardan. Nada é cancelado sozinho. */
export function AsaasPenteFino() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["asaas-pente-fino"], queryFn: penteFino, staleTime: 60_000 });
  const d = q.data;
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["asaas-pente-fino"] });
    void qc.invalidateQueries({ queryKey: ["asaas-saude"] });
  };
  const ativos = (d?.fantasmas ?? []).filter((f) => !f.desfeito_em);
  return (
    <Panel title="Asaas × Lardan: diferenças">
      {q.isLoading ? <p className="text-sm text-ledger-muted">Carregando…</p> : null}
      {q.error ? <p className="text-sm font-medium text-ledger-text">{(q.error as Error).message}</p> : null}
      {d ? (
        <div className="space-y-5">
          <p className="text-sm text-ledger-text">
            Em aberto por pessoa (só quem tem cobrança no Asaas). Cobrança excluída ou alterada no Asaas aparece aqui na hora; nada é cancelado sozinho.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {d.resumo.map((r) => (
              <div key={r.categoria} className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
                <p className="ledger-eyebrow">{ROTULO_CATEGORIA[r.categoria]} · {r.pessoas} pessoas</p>
                <p className="mt-1 text-sm tabular-nums text-ledger-text">
                  Lardan <strong>{formatBRLFromCents(r.lardan_cents)}</strong> · Asaas <strong>{formatBRLFromCents(r.asaas_cents)}</strong>
                </p>
              </div>
            ))}
          </div>
          <div>
            <p className="ledger-eyebrow mb-1">Alertas abertos ({d.alertas.length})</p>
            <p className="mb-2 text-xs text-ledger-muted">
              "Cancelar no Lardan" só funciona em parcela única, sem pagamento e sem cobrança viva no Asaas; cliente com processo judicial fica para decisão manual.
            </p>
            {d.alertas.length === 0 ? <p className="text-sm text-ledger-muted">Nenhum alerta aberto.</p> : (
              <ul>{d.alertas.map((a) => <LinhaAlerta key={a.id} a={a} onFeito={atualizar} />)}</ul>
            )}
          </div>
          {ativos.length ? (
            <div>
              <p className="ledger-eyebrow mb-2">Canceladas por cobrança excluída ({ativos.length})</p>
              <ul>{ativos.map((f) => <LinhaFantasma key={f.id} f={f} onFeito={atualizar} />)}</ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
