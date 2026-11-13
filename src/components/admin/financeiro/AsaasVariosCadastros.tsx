import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Panel, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import { clientesVariosCadastros, trocarCadastroPrincipal, type CadastroAsaas, type ClienteVariosCadastros } from "@/lib/asaas-automatico";
import { useCapabilities } from "@/lib/capabilities";

const data = (d?: string | null) => (d ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${d.slice(0, 10)}T12:00:00`)) : "—");
const ESPELHO: Record<string, { rotulo: string; tom: "success" | "info" | "warning" | "danger" | "neutral" }> = {
  igual: { rotulo: "Igual ao Lardan", tom: "success" },
  atualizado: { rotulo: "Igual ao Lardan", tom: "success" },
  pendente: { rotulo: "Levando o Lardan", tom: "info" },
  processando: { rotulo: "Levando o Lardan", tom: "info" },
  diferente: { rotulo: "Diferente", tom: "warning" },
  erro: { rotulo: "Tentando de novo", tom: "danger" },
  excluido_no_asaas: { rotulo: "Excluído no Asaas", tom: "neutral" },
};

function Cadastro({ c, podeTrocar, onFeito }: { c: CadastroAsaas; podeTrocar: boolean; onFeito: () => void }) {
  const [aberta, setAberta] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const m = useMutation({
    mutationFn: () => trocarCadastroPrincipal(c.customer_id, motivo.trim()),
    onSuccess: () => { toast.success("Principal trocado. As próximas cobranças saem neste cadastro."); setAberta(false); setMotivo(""); onFeito(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const esp = c.situacao === "pendente" ? { rotulo: "Aguardando ligação", tom: "neutral" as const } : (ESPELHO[c.espelho ?? ""] ?? { rotulo: "Na fila", tom: "info" as const });
  return (
    <li className="border-b border-line-soft py-2 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-xs text-ledger-text">
          <span className="font-mono">{c.external_id}</span>
          <span className="text-ledger-muted"> · criado {data(c.criado)} · {c.abertas} {c.abertas === 1 ? "boleto aberto" : "boletos abertos"}</span>
          {c.abertas ? <span className="text-ledger-muted"> ({formatBRLFromCents(c.aberto_cents)})</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.principal ? <StatusBadge tone="info">Principal</StatusBadge> : null}
          <StatusBadge tone={esp.tom}>{esp.rotulo}</StatusBadge>
          {podeTrocar && !c.principal && c.situacao === "vinculado" && !aberta ? (
            <button type="button" className="admin-btn h-8 text-xs" onClick={() => setAberta(true)}>Trocar principal</button>
          ) : null}
        </div>
      </div>
      {aberta ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (obrigatório)"
            className="h-9 min-w-[16rem] flex-1 rounded-[10px] border border-line bg-surface px-3 text-sm text-ledger-text outline-none focus:border-champagne"
          />
          <button type="button" className="admin-btn h-9" disabled={m.isPending} onClick={() => setAberta(false)}>Voltar</button>
          <button type="button" className="admin-btn-primary h-9" disabled={motivo.trim().length < 5 || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Gravando…" : "Confirmar"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function Cliente({ k, podeTrocar, onFeito }: { k: ClienteVariosCadastros; podeTrocar: boolean; onFeito: () => void }) {
  const [aberto, setAberto] = React.useState(false);
  const total = k.cadastros.length;
  const tudoIgual = k.pendentes === 0 && k.iguais === total;
  return (
    <li className="border-b border-line-soft py-3 last:border-0">
      <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        <span className="min-w-0">
          <span className="text-sm font-semibold text-ledger-text">{k.pessoa}</span>
          {k.codigo ? <span className="ml-1 text-sm text-ledger-muted">· Cód. {k.codigo}</span> : null}
          <span className="block text-xs text-ledger-muted">
            {total} cadastros no Asaas · principal {k.principal ?? "ainda não definido"}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <StatusBadge tone={tudoIgual ? "success" : k.pendentes ? "neutral" : "info"}>
            {tudoIgual ? "Todos iguais ao Lardan" : k.pendentes ? "Aguardando ligação" : `${k.iguais} de ${total} conferidos`}
          </StatusBadge>
          <ChevronDown className={`h-4 w-4 text-ledger-muted transition-transform ${aberto ? "rotate-180" : ""}`} aria-hidden />
        </span>
      </button>
      {aberto ? <ul className="mt-2 rounded-[10px] border border-line-soft bg-cream-50 px-3">{k.cadastros.map((c) => <Cadastro key={c.customer_id} c={c} podeTrocar={podeTrocar} onFeito={onFeito} />)}</ul> : null}
    </li>
  );
}

/** 0312 — clientes com mais de um cadastro no Asaas: todos ligados, um principal, o cadastro do Lardan vai para todos. */
export function AsaasVariosCadastros() {
  const qc = useQueryClient();
  const caps = useCapabilities();
  const podeTrocar = caps.includes("finance.receivable.manage");
  const q = useQuery({ queryKey: ["asaas-varios-cadastros"], queryFn: clientesVariosCadastros, staleTime: 60_000 });
  const lista = q.data ?? [];
  const iguais = lista.filter((k) => k.pendentes === 0 && k.iguais === k.cadastros.length).length;
  return (
    <Panel title={`Clientes com vários cadastros no Asaas${q.data ? ` (${lista.length})` : ""}`}>
      <p className="text-sm text-ledger-text">
        Só para informar: não precisa fazer nada. Todos os cadastros da cliente no Asaas ficam ligados a ela, e o cadastro do Lardan (nome,
        celular, e-mail e endereço) vai para cada um deles. As cobranças novas e as reemissões pelo saldo saem no cadastro principal.
      </p>
      {q.data && lista.length ? (
        <p className="mt-2 text-sm text-ledger-muted">{iguais} de {lista.length} clientes com todos os cadastros iguais ao Lardan.</p>
      ) : null}
      {q.isLoading ? <p className="mt-3 text-sm text-ledger-muted">Carregando…</p> : null}
      {q.error ? <p className="mt-3 text-sm font-medium text-ledger-text">{(q.error as Error).message}</p> : null}
      {q.data && lista.length === 0 ? <p className="mt-3 text-sm text-ledger-muted">Nenhuma cliente com mais de um cadastro no Asaas.</p> : null}
      {lista.length ? (
        <ul className="mt-3">
          {lista.map((k) => <Cliente key={k.party_id} k={k} podeTrocar={podeTrocar} onFeito={() => void qc.invalidateQueries({ queryKey: ["asaas-varios-cadastros"] })} />)}
        </ul>
      ) : null}
    </Panel>
  );
}
