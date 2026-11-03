/**
 * 0159 — Meu financeiro: próximo acerto (data e valor), débitos em aberto com boleto/Pix e 2ª via,
 * Pix da Lardan e histórico de acertos (Lardan e SmallData). Só os dados dela.
 */
import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, ExternalLink, QrCode } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl, traduzir } from "@/lib/maletas";
import { consultoraSegundaVia } from "@/lib/pre-baixa.functions";
import { ROTULO_SITUACAO, type SituacaoPreBaixa } from "@/lib/pre-baixa";

type Dados = {
  proximo_acerto: { cycle_id: string; maleta: string; data: string | null; dias: number | null; situacao: string; valor_cents: number | null } | null;
  debitos: { installment_id: string; descricao: string; origem: string | null; vencimento: string; valor_cents: number; saldo_cents: number; atraso: number; url: string | null }[];
  acertos: { origem: "lardan" | "smalldata"; data: string | null; maleta: string; vendido_cents: number; comissao_cents: number; pagar_cents: number; pago_cents?: number; situacao: string; motivo?: string | null }[];
  /** 0200: cobranças que ela fez às clientes (Pix/cartão/boleto da Lardan) e ajustes de acerto depois da conferência. */
  cobrancas?: { order_id: string; codigo: string; cliente: string; valor_cents: number; forma: string | null; vencimento: string | null; situacao: string; pago_em: string | null; url: string | null }[];
  ajustes?: { tipo: "credito" | "debito"; valor_cents: number; abatido_cents?: number; motivo: string; data: string; maleta: string | null; resolvido: boolean | null }[];
  pix: { tipo: string; chave: string; favorecido: string } | null;
};
const dataBR = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");
const FORMA: Record<string, string> = { pix: "Pix", cartao: "Cartão", depois: "Boleto/Pix" };
const ORIGEM: Record<string, string> = { pre_baixa: "Acerto da maleta", pre_baixa_diferenca: "Diferença do acerto", fiado_historico: "Fiado", maleta_perdida: "Maleta perdida" };

export function MeuFinanceiro({ verMaleta }: { verMaleta: () => void }) {
  const q = useQuery({ queryKey: ["consultora", "financeiro"], queryFn: async () => {
    const { data, error } = await supabase.rpc("consultora_meu_financeiro" as never); if (error) throw error; return data as unknown as Dados;
  } });
  const via = useServerFn(consultoraSegundaVia);
  const [aberta, setAberta] = React.useState<{ id: string; url: string | null; copia: string | null; qr: string | null } | null>(null);
  const gerar = useMutation({
    mutationFn: (id: string) => via({ data: { installment: id } }).then((r) => ({ id, ...r })),
    onSuccess: (r) => setAberta(r), onError: (e) => toast.error(traduzir(e)),
  });
  if (q.isLoading) return <p className="text-base text-muted-foreground">Carregando seu financeiro…</p>;
  if (q.error || !q.data) return <p className="text-base text-destructive">{traduzir(q.error)}</p>;
  const d = q.data;
  const totalAberto = d.debitos.reduce((s, x) => s + Number(x.saldo_cents), 0);
  const vencido = d.debitos.filter((x) => x.atraso > 0).reduce((s, x) => s + Number(x.saldo_cents), 0);
  const cobrancas = d.cobrancas ?? [];
  const ajustes = d.ajustes ?? [];
  const aguardando = cobrancas.filter((c) => c.situacao === "pendente").reduce((s, c) => s + Number(c.valor_cents), 0);
  const pagas = cobrancas.filter((c) => c.situacao === "pago").reduce((s, c) => s + Number(c.valor_cents), 0);
  return (
    <div className="max-w-3xl space-y-5">
      <section className="rounded-3xl border border-border bg-card p-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Próximo acerto</p>
        {d.proximo_acerto ? (
          <>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div><p className="text-sm text-muted-foreground">Data</p><p className="text-2xl font-semibold">{dataBR(d.proximo_acerto.data)}</p></div>
              <div className="text-right"><p className="text-sm text-muted-foreground">{(d.proximo_acerto.valor_cents ?? 0) < 0 ? "A Lardan te deve" : "Valor"}</p><p className="text-2xl font-semibold">{d.proximo_acerto.valor_cents != null ? brl(Math.abs(d.proximo_acerto.valor_cents)) : "faça a pré-baixa"}</p></div>
            </div>
            <p className="mt-2 text-[0.95rem] text-muted-foreground">Maleta {d.proximo_acerto.maleta} · {d.proximo_acerto.situacao === "sem_pre_baixa" ? "pré-baixa ainda não começou" : ROTULO_SITUACAO[d.proximo_acerto.situacao as SituacaoPreBaixa]}</p>
            <button type="button" className="admin-btn mt-3 min-h-12 w-full justify-center text-base" onClick={verMaleta}>Abrir a maleta e fazer o acerto</button>
          </>
        ) : <p className="mt-1 text-base">Nenhuma maleta para acertar agora.</p>}
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between"><h2 className="text-[1.15rem] font-semibold">Débitos em aberto</h2><span className={vencido ? "text-destructive" : "text-muted-foreground"}>{brl(totalAberto)}{vencido ? ` · ${brl(vencido)} vencido` : ""}</span></div>
        {d.debitos.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-5 text-base text-muted-foreground">Você não tem débitos em aberto.</p> : (
          <ul className="space-y-2">{d.debitos.map((x) => (
            <li key={x.installment_id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <span><span className="block text-[1.02rem] font-semibold">{ORIGEM[x.origem ?? ""] ?? x.descricao}</span>
                  <span className={`block text-sm ${x.atraso ? "text-destructive" : "text-muted-foreground"}`}>Vence {dataBR(x.vencimento)}{x.atraso ? ` · ${x.atraso} dias de atraso` : ""}</span></span>
                <strong className="num text-lg">{brl(x.saldo_cents)}</strong>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {x.url && <a href={x.url} target="_blank" rel="noreferrer" className="admin-btn min-h-11 text-base"><ExternalLink className="size-4" aria-hidden /> Boleto / Pix</a>}
                <button type="button" className="admin-btn min-h-11 text-base" disabled={gerar.isPending} onClick={() => gerar.mutate(x.installment_id)}><QrCode className="size-4" aria-hidden /> {x.url ? "2ª via" : "Gerar Pix / boleto"}</button>
              </div>
              {aberta?.id === x.installment_id && (
                <div className="mt-3 space-y-2 rounded-xl bg-muted/50 p-3 text-center">
                  {aberta.qr && <img src={aberta.qr} alt="QR code do Pix" className="mx-auto size-48" />}
                  {aberta.copia && <button type="button" className="admin-btn min-h-11 text-base" onClick={() => { void navigator.clipboard.writeText(aberta.copia!); toast.success("Pix copia e cola copiado."); }}><Copy className="size-4" aria-hidden /> Copiar Pix</button>}
                  {aberta.url && <a className="block text-sm text-primary underline" href={aberta.url} target="_blank" rel="noreferrer">Abrir boleto</a>}
                </div>
              )}
            </li>))}</ul>
        )}
        {d.pix && <p className="text-sm text-muted-foreground">Pix da Lardan ({d.pix.tipo}) <strong className="text-foreground">{d.pix.chave}</strong> · {d.pix.favorecido}. Prefira o Pix gerado acima: ele dá baixa sozinho.</p>}
      </section>

      {(cobrancas.length > 0 || ajustes.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-[1.15rem] font-semibold">Cobranças às suas clientes</h2>
          <p className="text-[0.95rem] text-muted-foreground">O que a cliente paga à Lardan sai do seu acerto. Se ela pagar depois da conferência, vira crédito seu.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-card p-4"><span className="block text-sm text-muted-foreground">Aguardando a cliente</span><strong className="block num text-xl">{brl(aguardando)}</strong></div>
            <div className="rounded-2xl border border-border bg-card p-4"><span className="block text-sm text-muted-foreground">Pagas à Lardan</span><strong className="block num text-xl">{brl(pagas)}</strong></div>
          </div>
          {ajustes.length > 0 && (
            <ul className="space-y-2">{ajustes.map((a, i) => (
              <li key={i} className={`rounded-2xl border p-4 ${a.tipo === "credito" ? "border-success/40" : "border-destructive/40"}`}>
                <span className="flex items-start justify-between gap-3">
                  <span className="block text-[1.02rem] font-semibold">{a.tipo === "credito" ? "Crédito no acerto" : "Débito no acerto"}{a.maleta ? ` · ${a.maleta}` : ""}</span>
                  <strong className={`num text-lg ${a.tipo === "credito" ? "text-success" : "text-destructive"}`}>{a.tipo === "credito" ? "+" : "−"} {brl(a.valor_cents)}</strong>
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">{dataBR(a.data)} · {a.motivo}{a.tipo === "debito" || a.resolvido || Number(a.abatido_cents ?? 0) >= Number(a.valor_cents) ? "" : " · a Lardan vai acertar com você"}</span>
              </li>))}</ul>
          )}
          {cobrancas.length > 0 && (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">{cobrancas.map((c) => (
              <li key={c.order_id} className="flex items-center justify-between gap-3 p-4">
                <span><span className="block text-[1.02rem] font-semibold">{c.cliente} · {c.codigo}</span>
                  <span className="block text-sm text-muted-foreground">{FORMA[c.forma ?? ""] ?? "Cobrança"}{c.situacao === "pago" ? ` · paga em ${dataBR(c.pago_em)}` : c.vencimento ? ` · vence ${dataBR(c.vencimento)}` : ""}</span></span>
                <span className="text-right"><span className="block num font-semibold">{brl(c.valor_cents)}</span>
                  <span className={`block text-xs ${c.situacao === "pago" ? "text-success" : c.situacao === "estornado" ? "text-destructive" : "text-muted-foreground"}`}>{c.situacao === "pago" ? "paga à Lardan" : c.situacao === "estornado" ? "estornada" : "aguardando"}</span></span>
              </li>))}</ul>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-[1.15rem] font-semibold">Histórico de acertos</h2>
        {d.acertos.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-5 text-base text-muted-foreground">Seus acertos aparecem aqui.</p> : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">{d.acertos.map((a, i) => (
            <li key={i} className="flex items-center justify-between gap-3 p-4">
              <span><span className="block text-[1.02rem] font-semibold">{a.maleta}</span><span className="block text-sm text-muted-foreground">{dataBR(a.data)} · vendeu {brl(a.vendido_cents)} · comissão {brl(a.comissao_cents)}</span>{a.motivo ? <span className="mt-1 block text-sm text-destructive">{a.motivo}</span> : null}</span>
              <span className="text-right"><span className="block num font-semibold">{a.pagar_cents < 0 ? `crédito ${brl(-a.pagar_cents)}` : brl(a.pagar_cents)}</span><span className="block text-xs text-muted-foreground">{a.origem === "smalldata" ? "sistema antigo" : ROTULO_SITUACAO[a.situacao as SituacaoPreBaixa] ?? a.situacao}</span></span>
            </li>))}</ul>
        )}
      </section>
    </div>
  );
}
