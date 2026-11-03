/**
 * 0158 — Acerto pelo app (pré-baixa), dentro de "Minha maleta".
 * 1) A consultora marca quantas vendeu de cada peça (as pagas pelo app já vêm marcadas).
 * 2) Fecha a pré-baixa: o app mostra total vendido, comissão pela faixa e o valor exato a pagar, e gera o Pix.
 * 3) Depois do Pix: "aguardando conferência". A Lardan confere a maleta pelo código e encerra o acerto.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Copy, Minus, Plus, QrCode, Search } from "lucide-react";
import { abrirPreBaixa, lerPreBaixa, ROTULO_SITUACAO, venderNaPreBaixa, type PreBaixa } from "@/lib/pre-baixa";
import { preBaixaFecharPix } from "@/lib/pre-baixa.functions";

const brl = (c: number) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");
const msg = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? "Não deu certo. Tente de novo."));

function ProximaFaixa({ d }: { d: PreBaixa }) {
  const base = Number(d.calculo.base_faixa_cents);
  const prox = [...d.faixas].sort((a, b) => a.min_cents - b.min_cents).find((f) => Number(f.min_cents) > base);
  if (!prox) return <p className="text-sm text-muted-foreground">Você está na maior faixa de comissão.</p>;
  return <p className="text-sm text-muted-foreground">Venda mais <strong className="text-foreground">{brl(Number(prox.min_cents) - base)}</strong> e sua comissão sobe para <strong className="text-foreground">{Number(prox.percentual)}%</strong>.</p>;
}

export function AcertoApp({ cycleId, podeComecar = true }: { cycleId: string; podeComecar?: boolean }) {
  const qc = useQueryClient();
  const fecharPix = useServerFn(preBaixaFecharPix);
  const q = useQuery({ queryKey: ["consultora", "pre-baixa", cycleId], queryFn: () => lerPreBaixa(cycleId),
    refetchInterval: (x) => ((x.state.data as PreBaixa | null | undefined)?.situacao === "aguardando_pagamento" ? 10000 : false) });
  const [aberto, setAberto] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const [confirmar, setConfirmar] = React.useState(false);
  const [pix, setPix] = React.useState<{ valor_cents: number; copia: string | null; qr: string | null; url: string | null } | null>(null);
  const recarregar = () => void qc.invalidateQueries({ queryKey: ["consultora", "pre-baixa", cycleId] });

  const abrir = useMutation({ mutationFn: () => abrirPreBaixa(cycleId), onSuccess: () => { setAberto(true); recarregar(); }, onError: (e) => toast.error(msg(e)) });
  const vender = useMutation({
    mutationFn: (v: { variant: string; qtd: number }) => venderNaPreBaixa(cycleId, v.variant, v.qtd),
    onSuccess: recarregar, onError: (e) => toast.error(msg(e)),
  });
  const fechar = useMutation({
    mutationFn: () => fecharPix({ data: { cycle: cycleId } }),
    onSuccess: (r) => { setConfirmar(false); setPix(r); toast.success(r.valor_cents > 0 ? "Pré-baixa fechada. Pague o Pix para liberar a conferência." : "Pré-baixa fechada. Nada a pagar."); recarregar(); },
    onError: (e) => toast.error(msg(e)),
  });

  const d = q.data;
  if (q.isLoading) return null;
  const vendidas = d?.itens.reduce((s, i) => s + i.vendida, 0) ?? 0;
  const total = d?.itens.reduce((s, i) => s + i.enviada, 0) ?? 0;

  if (!d) {
    if (!podeComecar) return null;
    return (
      <section className="rounded-3xl border border-border bg-card p-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Acerto da maleta</p>
        <p className="mt-1 text-lg font-semibold">Faça o acerto pelo app</p>
        <p className="mt-1 text-sm text-muted-foreground">Marque o que vendeu, veja sua comissão e pague o acerto pelo Pix com o valor exato. Sem pré-baixa fechada, a Lardan não libera o kit novo.</p>
        <button type="button" className="btn-app-principal mt-4 w-full" disabled={abrir.isPending} onClick={() => abrir.mutate()}>Começar a pré-baixa</button>
      </section>
    );
  }

  const c = d.calculo;
  const recebido = Number(c.recebido_lardan_cents ?? 0);
  const lista = d.itens.filter((i) => !busca.trim() || `${i.produto} ${i.variante ?? ""} ${i.sku ?? ""}`.toLowerCase().includes(busca.trim().toLowerCase()));
  const editavel = d.status === "aberta";

  return (
    <section className="space-y-4 rounded-3xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Acerto da maleta</p>
          <p className="mt-1 text-lg font-semibold">{ROTULO_SITUACAO[d.situacao]}</p>
          <p className="text-sm text-muted-foreground">Data do acerto {dataBR(d.prazo)}{d.dias_para_prazo != null && d.status === "aberta" ? (d.dias_para_prazo >= 0 ? ` · faltam ${d.dias_para_prazo} dias` : ` · atrasado ${-d.dias_para_prazo} dias`) : ""}</p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">Vendeu {vendidas} de {total} peças</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Vendido", brl(c.vendido_cents)], [`Sua comissão (${Number(c.comissao_pct)}%)`, brl(c.comissao_cents)],
          ...(recebido > 0 ? [["Clientes já pagaram à Lardan", brl(recebido)]] : []),
          c.valor_pagar_cents < 0 ? ["A Lardan te deve", brl(-c.valor_pagar_cents)] : ["Valor a pagar", brl(c.valor_pagar_cents)],
          ["Peças", `${vendidas}/${total}`]].map(([t, v]) => (
          <div key={t} className="rounded-2xl bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{t}</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{v}</p></div>
        ))}
      </div>
      {editavel && <ProximaFaixa d={d} />}

      {editavel && (
        <>
          <button type="button" className="text-sm font-semibold text-primary underline" onClick={() => setAberto(!aberto)}>
            {aberto ? "Esconder as peças" : "Marcar as peças vendidas"}
          </button>
          {aberto && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 rounded-xl border border-border px-3"><Search className="size-4 text-muted-foreground" aria-hidden />
                <input className="h-11 flex-1 bg-transparent text-base outline-none" placeholder="Buscar peça" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </label>
              <ul className="divide-y divide-border rounded-2xl border border-border">
                {lista.map((i) => (
                  <li key={i.variant_id} className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.98rem] font-medium">{i.produto}{i.variante && !["U", "UN"].includes(i.variante) ? ` · ${i.variante}` : ""}</p>
                      <p className="text-xs text-muted-foreground">{i.sku ?? ""} · {brl(i.preco_cents)} · recebeu {i.enviada}{i.app ? ` · ${i.app} paga(s) pelo app` : ""}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label="Uma a menos" className="grid size-10 place-items-center rounded-full border border-border disabled:opacity-40"
                        disabled={vender.isPending || i.vendida <= i.app} onClick={() => vender.mutate({ variant: i.variant_id, qtd: i.vendida - 1 })}><Minus className="size-4" /></button>
                      <span className="w-8 text-center text-lg font-semibold tabular-nums">{i.vendida}</span>
                      <button type="button" aria-label="Uma a mais" className="grid size-10 place-items-center rounded-full border border-border disabled:opacity-40"
                        disabled={vender.isPending || i.vendida >= i.enviada} onClick={() => vender.mutate({ variant: i.variant_id, qtd: i.vendida + 1 })}><Plus className="size-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!confirmar ? (
            <button type="button" className="btn-app-principal w-full" onClick={() => setConfirmar(true)}>Fechar a pré-baixa</button>
          ) : (
            <div className="space-y-3 rounded-2xl border border-warning/50 bg-warning/5 p-4">
              <p className="text-[0.98rem]">Você vendeu <strong>{vendidas}</strong> peças ({brl(c.vendido_cents)}). Fica com <strong>{brl(c.comissao_cents)}</strong> de comissão{recebido > 0 ? <>, as clientes já pagaram <strong>{brl(recebido)}</strong> direto à Lardan</> : null}
                {c.valor_pagar_cents > 0 ? <> e paga <strong>{brl(c.valor_pagar_cents)}</strong> à Lardan.</> : c.valor_pagar_cents < 0 ? <>: a Lardan fica te devendo <strong>{brl(-c.valor_pagar_cents)}</strong>.</> : <>: não há nada a pagar.</>}</p>
              <p className="text-sm text-muted-foreground">Depois de fechar não dá para mudar. As peças que não vendeu voltam na maleta: a Lardan confere pelo código.</p>
              <div className="flex gap-2">
                <button type="button" className="h-12 flex-1 rounded-full border border-border" onClick={() => setConfirmar(false)}>Voltar</button>
                <button type="button" className="btn-app-principal flex-1" disabled={fechar.isPending} onClick={() => fechar.mutate()}>{fechar.isPending ? "Gerando o Pix…" : "Fechar e pagar"}</button>
              </div>
            </div>
          )}
        </>
      )}

      {d.situacao === "aguardando_pagamento" && (
        pix ? (
          <div className="space-y-3 rounded-2xl border border-border p-4 text-center">
            <p className="font-semibold">Pix de {brl(pix.valor_cents)}</p>
            {pix.qr ? <img src={pix.qr} alt="QR code do Pix" className="mx-auto size-52" /> : <QrCode className="mx-auto size-16 text-muted-foreground" aria-hidden />}
            {pix.copia && (
              <button type="button" className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-4"
                onClick={() => { void navigator.clipboard.writeText(pix.copia!); toast.success("Pix copia e cola copiado."); }}>
                <Copy className="size-4" aria-hidden /> Copiar Pix copia e cola
              </button>
            )}
            {pix.url && <a className="block text-sm text-primary underline" href={pix.url} target="_blank" rel="noreferrer">Abrir a cobrança</a>}
            <p className="text-xs text-muted-foreground">Assim que o Pix cair, o acerto muda sozinho para "aguardando conferência".</p>
          </div>
        ) : (
          <button type="button" className="btn-app-principal w-full" disabled={fechar.isPending} onClick={() => fechar.mutate()}>Ver o Pix do acerto</button>
        )
      )}
      {d.situacao === "aguardando_conferencia" && (
        <p className="flex items-center gap-2 rounded-2xl bg-muted/50 p-4 text-[0.98rem]"><Check className="size-5 text-primary" aria-hidden /> Pago. Envie a maleta: a Lardan confere as peças pelo código e encerra o acerto.</p>
      )}
      {d.situacao === "encerrada" && <p className="rounded-2xl bg-muted/50 p-4 text-[0.98rem]">Acerto encerrado{d.encerrada_em ? ` em ${new Date(d.encerrada_em).toLocaleDateString("pt-BR")}` : ""}. Sua comissão está liberada.</p>}
      {d.situacao === "pendencia" && <p className="rounded-2xl border border-destructive/40 p-4 text-[0.98rem] text-destructive">{d.pendencia_motivo ?? "A conferência encontrou diferença. A Lardan vai falar com você."}</p>}
    </section>
  );
}
