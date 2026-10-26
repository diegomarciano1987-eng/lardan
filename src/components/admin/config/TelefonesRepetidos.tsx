/**
 * 0160 — Telefones repetidos no cadastro (o mesmo número duas vezes na mesma pessoa, ex.: como telefone e como WhatsApp).
 * Prévia → o Master aplica (cópia guardada em contact_points_duplicados_log) → dá para desfazer pelo lote.
 * Fica o WhatsApp (ou o principal, ou o mais antigo). Os números já são gravados no padrão +55DDDNÚMERO.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Panel } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import { foneBR } from "@/lib/representante";

type Linha = { party_id: string; nome: string; numero: string; manter_tipo: string; remover_qtd: number };

export function TelefonesRepetidos({ master }: { master: boolean }) {
  const qc = useQueryClient();
  const [ver, setVer] = React.useState(false);
  const [confirma, setConfirma] = React.useState("");
  const [lote, setLote] = React.useState<string | null>(null);
  const q = useQuery({
    queryKey: ["contatos-repetidos"], enabled: ver, retry: false,
    queryFn: async () => { const { data, error } = await supabase.rpc("contatos_duplicados_previa" as never); if (error) throw error; return data as unknown as Linha[]; },
  });
  const aplicar = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.rpc("contatos_duplicados_aplicar" as never, { _confirmacao: confirma } as never); if (error) throw error; return data as unknown as { lote: string; removidos: number }; },
    onSuccess: (r) => { toast.success(`${r.removidos} telefone(s) repetido(s) removido(s).`); setLote(r.lote); setConfirma(""); void qc.invalidateQueries({ queryKey: ["contatos-repetidos"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const desfazer = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.rpc("contatos_duplicados_desfazer" as never, { _lote: lote } as never); if (error) throw error; return data as unknown as number; },
    onSuccess: (n) => { toast.success(`${n} telefone(s) restaurado(s).`); setLote(null); void qc.invalidateQueries({ queryKey: ["contatos-repetidos"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const total = (q.data ?? []).reduce((a, l) => a + l.remover_qtd, 0);
  return (
    <Panel title="Telefones repetidos no cadastro">
      <div className="space-y-3 text-sm">
        <p className="text-ledger-muted">O mesmo número cadastrado mais de uma vez na mesma pessoa. Fica um só (o WhatsApp, se houver).</p>
        {!ver ? <button type="button" className="admin-btn" onClick={() => setVer(true)}>Ver prévia</button> : q.isLoading ? <p>Carregando…</p> : q.error ? <p className="text-destructive">{(q.error as Error).message}</p> : (
          <>
            <p><strong>{q.data!.length}</strong> pessoa(s) · <strong>{total}</strong> telefone(s) a remover.</p>
            {q.data!.length > 0 && (
              <ul className="max-h-64 divide-y divide-line-soft overflow-auto rounded-xl border border-line-soft">
                {q.data!.slice(0, 200).map((l) => (
                  <li key={`${l.party_id}${l.numero}`} className="flex justify-between gap-2 px-3 py-1.5"><span className="truncate">{l.nome}</span><span className="shrink-0 tabular-nums">{foneBR(l.numero)} · fica {l.manter_tipo} · tira {l.remover_qtd}</span></li>
                ))}
              </ul>
            )}
            {master && total > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <input className="admin-input w-56" placeholder="Digite REMOVER REPETIDOS" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
                <button type="button" className="admin-btn admin-btn-primary" disabled={aplicar.isPending || confirma !== "REMOVER REPETIDOS"} onClick={() => aplicar.mutate()}>Aplicar limpeza</button>
              </div>
            )}
          </>
        )}
        {lote && master && <button type="button" className="admin-btn" disabled={desfazer.isPending} onClick={() => desfazer.mutate()}>Desfazer esta limpeza</button>}
      </div>
    </Panel>
  );
}
