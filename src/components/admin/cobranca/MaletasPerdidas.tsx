/**
 * Cobrança → Maletas perdidas (0130). Cada maleta perdida já saiu da rua, não gerou nota
 * fiscal e virou fiado no cockpit da consultora (varejo das peças que não voltaram).
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { brl, dataBr, listarPerdidas, mensagem, processarPerdidasSmallData, type MaletaPerdida } from "@/lib/maletas-perdidas";

const SITUACAO: Record<MaletaPerdida["situacao"], string> = {
  fiado_gerado: "Fiado gerado",
  sem_cadastro: "Sem cadastro no Lardan",
  sem_valor: "Tudo voltou (sem fiado)",
};

export function MaletasPerdidas() {
  const [busca, setBusca] = React.useState("");
  const [termo, setTermo] = React.useState("");
  const [filtro, setFiltro] = React.useState("");
  const qc = useQueryClient();
  React.useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);
  const q = useQuery({ queryKey: ["cob", "perdidas", termo, filtro], queryFn: () => listarPerdidas(termo, filtro) });
  const processar = useMutation({
    mutationFn: () => processarPerdidasSmallData(true),
    onSuccess: (r) => {
      toast.success(`${r.perdidas} maletas perdidas no SmallData · ${r.fiados_gerados_agora} fiados novos.`);
      void qc.invalidateQueries({ queryKey: ["cob"] });
    },
    onError: (e) => toast.error(mensagem(e)),
  });
  const r = q.data?.resumo;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Maleta perdida sai da rua, não gera nota fiscal e vira fiado da consultora pelo varejo das peças que não voltaram. As do SmallData entram
        sozinhas a cada importação do histórico; as do Lardan entram quando a maleta recebe baixa como perdida.
      </div>
      {r && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Card rotulo="Consultoras" valor={String(r.consultoras)} />
          <Card rotulo="Maletas perdidas" valor={String(r.maletas)} />
          <Card rotulo="Valor das perdas" valor={brl(r.valor_cents)} />
          <Card rotulo="Em aberto" valor={brl(r.em_aberto_cents)} destaque={r.em_aberto_cents > 0} />
          <Card rotulo="Sem cadastro" valor={String(r.sem_cadastro)} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar consultora, código ou remessa"
          className="h-10 w-72 rounded-lg border border-border bg-background px-3 text-sm" />
        {([["", "Todas"], ["em_aberto", "Com saldo em aberto"], ["sem_cadastro", "Sem cadastro"], ["sem_valor", "Tudo voltou"]] as const).map(([k, rot]) => (
          <button key={k} onClick={() => setFiltro(k)}
            className={`h-10 rounded-full border px-3 text-xs ${filtro === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{rot}</button>
        ))}
        <button onClick={() => processar.mutate()} disabled={processar.isPending}
          className="ml-auto h-10 rounded-lg border border-border px-4 text-sm disabled:opacity-50">
          {processar.isPending ? "Conferindo…" : "Conferir perdidas do SmallData"}
        </button>
      </div>

      {q.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p>
        : q.error ? <p className="text-sm text-destructive">{mensagem(q.error)}</p>
        : (q.data?.lista.length ?? 0) === 0 ? <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhuma maleta perdida para estes filtros.</p>
        : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[60rem] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Consultora</th>
                  <th className="px-3 py-2">Remessa</th>
                  <th className="px-3 py-2">Praça · representante</th>
                  <th className="px-3 py-2">Perda</th>
                  <th className="px-3 py-2 text-right">Peças</th>
                  <th className="px-3 py-2 text-right">Fiado</th>
                  <th className="px-3 py-2 text-right">Em aberto</th>
                  <th className="px-3 py-2">Situação</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.lista.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      {m.party_id ? <Link to="/admin/cobranca/$id" params={{ id: m.party_id }} className="font-medium hover:underline">{m.consultora}</Link>
                        : <span className="font-medium">{m.consultora}</span>}
                      <span className="block text-xs text-muted-foreground">{m.codigo ?? "—"}{m.ja_tinha_fiado ? " · já tinha outro fiado" : ""}</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {m.cycle_id ? <Link to="/admin/maletas/$id" params={{ id: m.cycle_id }} className="hover:underline">{m.remessa ?? "Lardan"}</Link> : m.remessa}
                      <span className="block text-xs text-muted-foreground">{m.origem === "lardan" ? "Lardan" : "SmallData"}</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{[m.praca, m.representante].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{dataBr(m.data_perda)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.pecas}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl(m.valor_cents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{brl(m.saldo_cents)}</td>
                    <td className="px-3 py-2">{SITUACAO[m.situacao]}{m.titulo ? <span className="block text-xs text-muted-foreground">Título {m.titulo}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

function Card({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl border border-border bg-card p-4 ${destaque ? "ring-1 ring-destructive/40" : ""}`}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={`mt-1 font-mono text-xl tabular-nums ${destaque ? "text-destructive" : ""}`}>{valor}</p>
    </div>
  );
}
