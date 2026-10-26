/**
 * 0158 — Conferência do acerto (pré-baixa) quando a maleta chega.
 * Lê o código de cada peça que voltou; o sistema compara com o esperado (enviado − vendido declarado):
 * peça faltando = cobrada como vendida; peça declarada vendida que voltou = estorna. Bateu → encerra.
 * Também lista as peças que voltaram com preço antigo para imprimir a etiqueta nova.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ScanBarcode, Tags } from "lucide-react";
import { Panel, StatusBadge } from "@/components/admin/ui";
import { EtiquetasImprimir } from "@/components/admin/EtiquetasImprimir";
import { conferirPreBaixa, lerPreBaixa, marcarEtiquetas, resolverPendencia, ROTULO_SITUACAO, type Conferencia } from "@/lib/pre-baixa";
import { traduzir } from "@/lib/maletas";

const brl = (c: number) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ConferenciaPreBaixa({ cycleId, podeConferir }: { cycleId: string; podeConferir: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["maletas", "pre-baixa", cycleId], queryFn: () => lerPreBaixa(cycleId) });
  const [lidas, setLidas] = React.useState<Record<string, number>>({});
  const [codigo, setCodigo] = React.useState("");
  const [prev, setPrev] = React.useState<Conferencia | null>(null);
  const [motivo, setMotivo] = React.useState("");
  const campo = React.useRef<HTMLInputElement>(null);
  const d = q.data;
  const leituras = Object.entries(lidas).filter(([, n]) => n > 0).map(([variant_id, qtd]) => ({ variant_id, qtd }));
  const recarregar = () => { void qc.invalidateQueries({ queryKey: ["maletas"] }); };

  const previa = useMutation({ mutationFn: () => conferirPreBaixa(cycleId, leituras, false), onSuccess: setPrev, onError: (e) => toast.error(traduzir(e)) });
  const aplicar = useMutation({
    mutationFn: () => conferirPreBaixa(cycleId, leituras, true),
    onSuccess: (r) => { toast.success(r.status === "encerrada" ? "Acerto encerrado: bateu." : "Acerto com pendência registrada."); setPrev(null); recarregar(); },
    onError: (e) => toast.error(traduzir(e)),
  });
  const resolver = useMutation({ mutationFn: () => resolverPendencia(cycleId, motivo), onSuccess: () => { toast.success("Pendência resolvida."); setMotivo(""); recarregar(); }, onError: (e) => toast.error(traduzir(e)) });
  const etiquetas = useMutation({ mutationFn: (v: string[]) => marcarEtiquetas(cycleId, v), onSuccess: () => { toast.success("Etiquetas marcadas como atualizadas."); recarregar(); } });

  if (!d) return null;
  const ler = (e: React.FormEvent) => {
    e.preventDefault();
    const t = codigo.trim().toUpperCase();
    if (!t) return;
    const it = d.itens.find((i) => [i.barcode, i.sku].some((x) => x && x.toUpperCase() === t));
    setCodigo("");
    campo.current?.focus();
    if (!it) { toast.error(`Código ${t} não é desta maleta.`); return; }
    const atual = lidas[it.variant_id] ?? 0;
    if (atual >= it.enviada) { toast.error(`Já foram lidas todas as ${it.enviada} unidades de ${it.produto}.`); return; }
    setLidas({ ...lidas, [it.variant_id]: atual + 1 });
    setPrev(null);
  };
  const conferivel = podeConferir && (d.situacao === "aguardando_pagamento" || d.situacao === "aguardando_conferencia");
  const etiquetasNovas = d.itens.filter((i) => i.etiqueta_nova && (i.lida ?? 0) > 0 && !i.etiqueta_atualizada);

  return (
    <Panel title="Acerto pelo app (pré-baixa)">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={d.situacao === "encerrada" ? "success" : d.situacao === "pendencia" ? "danger" : "warning"}>{ROTULO_SITUACAO[d.situacao]}</StatusBadge>
          <span className="text-ledger-muted">Vendido {brl(d.calculo.vendido_cents)} · comissão {Number(d.calculo.comissao_pct)}% · a pagar {brl(d.calculo.valor_pagar_cents)}</span>
        </div>
        {d.situacao === "aguardando_pagamento" && <p className="text-ledger-muted">A consultora fechou a pré-baixa, mas o Pix ainda não caiu. Dá para conferir a maleta assim mesmo; o título continua em aberto na cobrança.</p>}

        {conferivel && (
          <>
            <form onSubmit={ler} className="flex gap-2">
              <label className="flex flex-1 items-center gap-2 rounded-lg border border-line-soft px-3">
                <ScanBarcode aria-hidden className="size-4 text-ledger-muted" />
                <input ref={campo} autoFocus className="h-11 flex-1 bg-transparent outline-none" placeholder="Leia o código da peça que voltou" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
              </label>
              <button type="submit" className="admin-btn">Ler</button>
            </form>
            <div className="max-h-80 overflow-auto rounded-xl border border-line-soft">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface text-left text-ledger-muted"><tr>
                  <th className="px-3 py-2">Peça</th><th className="px-3 py-2 text-center">Enviada</th><th className="px-3 py-2 text-center">Vendida (app)</th>
                  <th className="px-3 py-2 text-center">Deve voltar</th><th className="px-3 py-2 text-center">Lida</th></tr></thead>
                <tbody>{d.itens.map((i) => {
                  const deve = i.enviada - i.vendida; const lida = lidas[i.variant_id] ?? 0;
                  return (
                    <tr key={i.variant_id} className={`border-t border-line-soft ${lida === deve ? "" : "bg-warning/5"}`}>
                      <td className="px-3 py-1.5">{i.produto}<span className="block text-ledger-muted">{i.sku ?? i.barcode ?? ""}</span></td>
                      <td className="px-3 py-1.5 text-center">{i.enviada}</td><td className="px-3 py-1.5 text-center">{i.vendida}</td>
                      <td className="px-3 py-1.5 text-center">{deve}</td>
                      <td className="px-3 py-1.5 text-center font-semibold">
                        <button type="button" className="px-1 text-ledger-muted" aria-label="Tirar uma leitura" disabled={!lida} onClick={() => { setLidas({ ...lidas, [i.variant_id]: lida - 1 }); setPrev(null); }}>−</button>
                        {lida}
                      </td>
                    </tr>);
                })}</tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="admin-btn" disabled={previa.isPending} onClick={() => previa.mutate()}>Conferir resultado</button>
              {prev && (
                <button type="button" className="admin-btn admin-btn-primary" disabled={aplicar.isPending} onClick={() => aplicar.mutate()}>
                  <CheckCircle2 aria-hidden className="size-4" /> {prev.bateu ? "Bateu: encerrar o acerto" : "Encerrar com pendência"}
                </button>
              )}
            </div>
            {prev && (
              <div className={`rounded-xl border p-3 ${prev.bateu ? "border-success/40 bg-success/5" : "border-warning/50 bg-warning/5"}`}>
                {prev.bateu ? <p>Tudo bateu com a pré-baixa.</p> : (
                  <p>
                    {prev.pecas_faltando ? `${prev.pecas_faltando} peça(s) faltando: cobradas como vendidas. ` : ""}
                    {prev.pecas_voltaram_vendidas ? `${prev.pecas_voltaram_vendidas} peça(s) declaradas vendidas voltaram: estorno. ` : ""}
                    Vendido final {brl(prev.vendido_final_cents)} · comissão {Number(prev.comissao_pct)}% · diferença{" "}
                    <strong>{prev.diferenca_cents > 0 ? `${brl(prev.diferenca_cents)} a cobrar` : `${brl(-prev.diferenca_cents)} a devolver`}</strong>.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {d.situacao === "pendencia" && (
          <div className="space-y-2 rounded-xl border border-destructive/40 p-3">
            <p className="text-destructive">{d.pendencia_motivo}</p>
            {podeConferir && (
              <div className="flex flex-wrap gap-2">
                <input className="admin-input flex-1" placeholder="Como foi resolvida (ex.: pagou a diferença no Pix)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <button type="button" className="admin-btn" disabled={resolver.isPending || motivo.trim().length < 5} onClick={() => resolver.mutate()}>Marcar como resolvida</button>
              </div>
            )}
          </div>
        )}

        {etiquetasNovas.length > 0 && (
          <div className="space-y-2 rounded-xl border border-line-soft p-3">
            <p className="flex items-center gap-2 font-semibold"><Tags aria-hidden className="size-4" /> {etiquetasNovas.length} peça(s) voltaram com preço antigo: imprima a etiqueta nova</p>
            <EtiquetasImprimir origens={etiquetasNovas.map((i) => ({ variantId: i.variant_id, quantidade: i.lida ?? 1 }))} />
            <button type="button" className="admin-btn" onClick={() => etiquetas.mutate(etiquetasNovas.map((i) => i.variant_id))}>Marcar etiquetas como atualizadas</button>
          </div>
        )}
      </div>
    </Panel>
  );
}
