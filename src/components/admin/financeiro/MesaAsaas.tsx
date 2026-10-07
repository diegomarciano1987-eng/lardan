import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Panel } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";

type Pend = { id: string; external_id: string; value_cents: number; liquido_cents: number; payment_date: string | null; nome: string | null; doc: string | null; descricao: string | null; party_id: string | null };
type Cand = { installment_id: string; numero: string; descricao: string; nome: string; parcela: number; vencimento: string; saldo_cents: number; mesma_pessoa: boolean };

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dt = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
async function rpc<T>(f: string, a: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(f as never, a as never);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Dinheiro que caiu no Asaas sem título reconhecido: o Daniel escolhe o título ou cria um novo. */
export function MesaAsaas() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [pag, setPag] = useState(0);
  const [aberta, setAberta] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["asaas-mesa", busca, pag],
    queryFn: () => rpc<{ total: number; soma_cents: number; itens: Pend[] }>("asaas_mesa_pendentes", { _busca: busca || null, _offset: pag * 50 }),
  });
  const total = q.data?.total ?? 0;
  return (
    <Panel title="Mesa de conciliação Asaas — recebido sem título">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-ledger-muted">
            {q.isLoading ? "Carregando…" : `${total} recebimento(s) aguardando · ${brl(q.data?.soma_cents ?? 0)}`}
          </p>
          <input className="admin-input min-h-10 w-72" placeholder="Buscar nome, CPF ou código Asaas" value={busca}
            onChange={(e) => { setBusca(e.target.value); setPag(0); }} />
        </div>
        {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}
        {!q.isLoading && total === 0 && <p className="text-ledger-muted">Sem dados: nenhum recebimento pendente.</p>}
        <div className="divide-y divide-line-soft rounded-xl border border-line-soft">
          {(q.data?.itens ?? []).map((p) => (
            <div key={p.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{p.nome ?? "Cliente sem cadastro"} <span className="text-ledger-muted font-normal">{p.doc}</span></p>
                  <p className="text-xs text-ledger-muted">Pago em {dt(p.payment_date)} · {p.external_id}{p.descricao ? ` · ${p.descricao}` : ""}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{brl(p.value_cents)}</span>
                  <button type="button" className="admin-btn min-h-10" onClick={() => setAberta(aberta === p.id ? null : p.id)}>
                    {aberta === p.id ? "Fechar" : "Resolver"}
                  </button>
                </div>
              </div>
              {aberta === p.id && <Resolver p={p} onDone={() => { setAberta(null); qc.invalidateQueries({ queryKey: ["asaas-mesa"] }); }} />}
            </div>
          ))}
        </div>
        {total > 50 && (
          <div className="flex items-center gap-2">
            <button type="button" className="admin-btn min-h-9" disabled={pag === 0} onClick={() => setPag(pag - 1)}>Anterior</button>
            <span>Página {pag + 1} de {Math.ceil(total / 50)}</span>
            <button type="button" className="admin-btn min-h-9" disabled={(pag + 1) * 50 >= total} onClick={() => setPag(pag + 1)}>Próxima</button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Resolver({ p, onDone }: { p: Pend; onDone: () => void }) {
  const [b, setB] = useState("");
  const c = useQuery({ queryKey: ["asaas-mesa-cand", p.id, b], queryFn: () => rpc<Cand[]>("asaas_mesa_candidatas", { _charge: p.id, _busca: b || null }) });
  const fim = (r: { baixa?: boolean; motivo?: string }) =>
    r.baixa ? toast.success("Vinculado e baixado.") : toast.warning(`Vinculado; baixa não feita: ${r.motivo ?? "verificar"}.`);
  const vinc = useMutation({ mutationFn: (inst: string) => rpc<{ baixa?: boolean; motivo?: string }>("asaas_mesa_vincular", { _charge: p.id, _installment: inst }),
    onSuccess: (r) => { fim(r); onDone(); }, onError: (e) => toast.error((e as Error).message) });
  const novo = useMutation({ mutationFn: () => rpc<{ baixa?: boolean; motivo?: string }>("asaas_mesa_novo_titulo", { _charge: p.id }),
    onSuccess: (r) => { fim(r); onDone(); }, onError: (e) => toast.error((e as Error).message) });
  return (
    <div className="mt-4 space-y-3 rounded-xl bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input className="admin-input min-h-10 flex-1" placeholder="Buscar título de outra pessoa (nome, número, descrição)" value={b} onChange={(e) => setB(e.target.value)} />
        <button type="button" className="admin-btn min-h-10" disabled={novo.isPending || !p.party_id}
          title={p.party_id ? "" : "Cliente sem cadastro"}
          onClick={() => confirm(`Criar título novo de ${brl(p.value_cents)} e baixar?`) && novo.mutate()}>
          Criar título novo e baixar
        </button>
      </div>
      {c.isLoading ? <p className="text-ledger-muted">Procurando títulos…</p> : (c.data ?? []).length === 0 ? (
        <p className="text-ledger-muted">Sem títulos em aberto {b ? "para essa busca" : "dessa pessoa"}.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ledger-muted"><tr><th className="py-1">Título</th><th>Pessoa</th><th>Venc.</th><th className="text-right">Saldo</th><th /></tr></thead>
          <tbody>
            {c.data!.map((x) => (
              <tr key={x.installment_id} className="border-t border-line-soft">
                <td className="py-2">{x.numero} · {x.parcela}<div className="text-xs text-ledger-muted">{x.descricao}</div></td>
                <td>{x.nome}{x.mesma_pessoa && <span className="ml-1 text-xs text-primary">mesma pessoa</span>}</td>
                <td>{dt(x.vencimento)}</td>
                <td className={`text-right tabular-nums ${x.saldo_cents === p.value_cents ? "font-semibold text-primary" : ""}`}>{brl(x.saldo_cents)}</td>
                <td className="text-right">
                  <button type="button" className="admin-btn min-h-9" disabled={vinc.isPending || p.value_cents > x.saldo_cents}
                    title={p.value_cents > x.saldo_cents ? "Valor pago maior que o saldo" : ""}
                    onClick={() => vinc.mutate(x.installment_id)}>
                    {p.value_cents < x.saldo_cents ? "Vincular (baixa parcial)" : "Vincular e baixar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
