import * as React from "react";
import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, MessageCircle, ShoppingBag, ArrowRight, Clock3, CheckCircle2, CalendarDays, XCircle, Package, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PagamentoLardan } from "@/components/consultora/PagamentoLardan";
import { AbrirPosVenda } from "@/components/consultora/PosVenda";
import { brl, detalhePedido, listarPedidos, mudarSituacaoPedido, SITUACAO_PEDIDO, traduzir, type PedidoResumo } from "@/lib/maletas";
import { linkWhats } from "@/lib/consultora";
import { idadePedido, mensagemPedido, tomIdade } from "@/lib/consultora-regras";
import { pedidosQuery } from "@/lib/consultora-queries";

const GRUPOS = ["Atendendo", "Aguardando pagamento", "Pagos", "Cancelados"] as const;
function grupo(p: PedidoResumo) {
  if (p.status === "cancelado") return "Cancelados";
  if (p.payment_status === "pago") return "Pagos";
  return p.status === "aguardando_pagamento" ? "Aguardando pagamento" : "Atendendo";
}
export function PedidosConsultora() {
  const qc = useQueryClient();
  const q = useQuery(pedidosQuery());
  const [aba, setAba] = React.useState<typeof GRUPOS[number]>("Atendendo");
  const [cancelar, setCancelar] = React.useState<PedidoResumo | null>(null);
  const [aberto, setAberto] = React.useState<PedidoResumo | null>(null);
  const detalhe = useQuery({ queryKey: ["consultora", "pedido", aberto?.id], queryFn: () => aberto ? detalhePedido(aberto.id) : Promise.resolve(null), enabled: !!aberto });
  const mudar = useMutation({ mutationFn: (v: { id: string; status: string }) => mudarSituacaoPedido(v.id, v.status), onSuccess: () => { setCancelar(null); toast.success("Pedido atualizado."); void qc.invalidateQueries({ queryKey: ["consultora"] }); }, onError: (e) => toast.error(traduzir(e)) });
  if (q.isLoading) return <div role="status" className="flex items-center gap-3 py-12 text-muted-foreground"><LoaderCircle className="size-5 animate-spin" /> Carregando pedidos…</div>;
  if (q.isError) return <p role="alert">{traduzir(q.error)}</p>;
  const lista = q.data ?? [];
  const visiveis = lista.filter((p) => grupo(p) === aba);
  return <div className="space-y-7">
    <div role="tablist" aria-label="Situação dos pedidos" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{GRUPOS.map((g) => {
      const itens = lista.filter((p) => grupo(p) === g);
      const Icon = g === "Pagos" ? CheckCircle2 : g === "Cancelados" ? XCircle : g === "Aguardando pagamento" ? Clock3 : ShoppingBag;
      return <Button key={g} id={`pedidos-tab-${GRUPOS.indexOf(g)}`} aria-controls="pedidos-lista" type="button" role="tab" aria-selected={aba === g} variant="outline" className={`h-full min-h-32 min-w-0 flex-col items-stretch justify-between gap-4 whitespace-normal rounded-lg px-4 py-4 text-left shadow-none sm:px-5 ${aba === g ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card"}`} onClick={() => setAba(g)}><span className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2"><span className="min-w-0 font-semibold leading-snug">{g}</span><Icon aria-hidden className={`mt-1 shrink-0 ${aba === g ? "text-primary" : "text-muted-foreground"}`} /></span><span className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1"><strong className="break-all text-xl tabular-nums">{brl(itens.reduce((s, p) => s + Number(p.subtotal_cents), 0))}</strong><span className="text-base text-muted-foreground">{itens.length}</span></span></Button>;
    })}</div>
    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-3"><h2 className="text-xl font-semibold">{aba}</h2><span className="shrink-0 text-base text-muted-foreground">{visiveis.length} {visiveis.length === 1 ? "pedido" : "pedidos"}</span></div>
    {visiveis.length === 0 && <div className="flex flex-col items-center gap-4 py-12 text-center"><ShoppingBag aria-hidden className="size-10 text-muted-foreground" /><p className="text-lg text-muted-foreground">Sem pedidos nesta situação.</p></div>}
    <ul id="pedidos-lista" role="tabpanel" aria-labelledby={`pedidos-tab-${GRUPOS.indexOf(aba)}`} className="grid items-stretch gap-4 xl:grid-cols-2">{visiveis.map((p) => {
      const dias = idadePedido(p.created_at); const tom = tomIdade(dias);
      const cor = tom === "success" ? "bg-success/15 text-success" : tom === "warning" ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive";
      const whats = p.customer_phone ? linkWhats(p.customer_phone, mensagemPedido(p)) : null;
      return <li key={p.id} className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex-1 p-5 sm:p-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"><div className="flex min-w-0 items-start gap-3"><span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-secondary text-xl font-semibold text-secondary-foreground">{p.customer_name.trim().slice(0, 1).toUpperCase()}</span><div className="min-w-0"><h3 className="break-words text-xl font-semibold leading-snug">{p.customer_name}</h3><span className="mt-1 block text-base text-muted-foreground">{p.code}</span></div></div>
          {!["concluido", "cancelado"].includes(p.status) && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-12 shrink-0" title="Mais ações" aria-label={`Mais ações do pedido ${p.code}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem className="min-h-12 text-lg text-destructive" onSelect={() => setCancelar(p)}><XCircle aria-hidden />Cancelar pedido</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2"><span className="rounded bg-secondary px-3 py-1.5 text-base font-medium text-secondary-foreground">{p.payment_status === "pago" ? "Pago" : SITUACAO_PEDIDO[p.status]?.rotulo ?? p.status}</span>{!["Pagos", "Cancelados"].includes(grupo(p)) && <span className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-base font-medium ${cor}`}><Clock3 aria-hidden className="size-4" />Há {dias} {dias === 1 ? "dia" : "dias"}</span>}</div>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3"><div className="min-w-0"><span className="text-base text-muted-foreground">Valor do pedido</span><strong className="mt-1 block break-all text-3xl font-semibold tabular-nums">{brl(Number(p.subtotal_cents))}</strong></div><span className="inline-flex items-center gap-2 pb-1 text-base text-muted-foreground"><Package aria-hidden className="size-4" />{p.items_count} {Number(p.items_count) === 1 ? "peça" : "peças"}</span></div>
        <span className="mt-4 flex items-center gap-2 text-base text-muted-foreground"><CalendarDays aria-hidden className="size-4" />{new Date(p.created_at).toLocaleDateString("pt-BR")}</span>
        </div>
        <div className="grid gap-3 border-t border-border px-5 py-4 sm:px-6">
          {p.status === "aguardando_atendimento" && <Button className="h-auto min-h-12 justify-between px-4 py-3" disabled={mudar.isPending} onClick={() => mudar.mutate({ id: p.id, status: "em_atendimento" })}>Começar atendimento<ArrowRight aria-hidden /></Button>}
          {p.status === "em_atendimento" && <Button className="h-auto min-h-12 justify-between px-4 py-3" disabled={mudar.isPending} onClick={() => mudar.mutate({ id: p.id, status: "aguardando_pagamento" })}>Combinar pagamento<ArrowRight aria-hidden /></Button>}
          <div className={`grid gap-2 ${whats ? "sm:grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-1"}`}><Button variant="outline" className="h-auto min-h-12 min-w-0 whitespace-normal px-3 py-3 shadow-none" onClick={() => setAberto(p)}><ShoppingBag aria-hidden />Ver peças e pagamento</Button><Button asChild variant="outline" className="h-auto min-h-12 min-w-0 whitespace-normal px-3 py-3 shadow-none"><Link to="/consultora-garantia/$id" params={{ id: p.id }} target="_blank"><FileText aria-hidden />Comprovante e garantia</Link></Button>
          {whats && <Button asChild variant="ghost" className="h-auto min-h-12 px-3 py-3"><a href={whats} target="_blank" rel="noreferrer"><MessageCircle aria-hidden />WhatsApp</a></Button>}</div>
          {p.payment_status === "pago" && p.status !== "cancelado" && <AbrirPosVenda pedido={p.id} />}
        </div>
      </li>;
    })}</ul>
    <Dialog open={!!cancelar} onOpenChange={(v) => { if (!v) setCancelar(null); }}><DialogContent><DialogHeader><DialogTitle>Cancelar {cancelar?.code}?</DialogTitle><DialogDescription>O pedido será cancelado. O histórico fica preservado e reservas existentes serão liberadas.</DialogDescription></DialogHeader><div className="flex gap-3"><Button variant="outline" onClick={() => setCancelar(null)}>Voltar</Button><Button variant="destructive" disabled={mudar.isPending} onClick={() => { if (cancelar) mudar.mutate({ id: cancelar.id, status: "cancelado" }); }}>Confirmar cancelamento</Button></div></DialogContent></Dialog>
    <Dialog open={!!aberto} onOpenChange={(v) => { if (!v) setAberto(null); }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Pedido {aberto?.code}</DialogTitle><DialogDescription>{aberto?.customer_name}</DialogDescription></DialogHeader>
      {detalhe.isLoading && <p>Carregando peças…</p>}{detalhe.isError && <p role="alert">{traduzir(detalhe.error)}</p>}
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-y border-border py-4"><span className="text-lg text-muted-foreground">Valor do pedido</span><strong className="text-2xl font-semibold tabular-nums">{brl(Number(aberto?.subtotal_cents ?? 0))}</strong></div>
      <ul className="divide-y divide-border">{detalhe.data?.itens.map((i) => <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-4"><div className="min-w-0"><p className="font-semibold">{i.product_name}</p><p className="mt-1 text-muted-foreground">{i.quantity}× {i.variant_label}</p></div><strong className="pt-1 text-lg tabular-nums">{brl(i.unit_price_cents * i.quantity)}</strong></li>)}</ul>
      {aberto && !["cancelado"].includes(aberto.status) && aberto.payment_status !== "pago" && <PagamentoLardan pedido={aberto.id} total={aberto.subtotal_cents} cliente={aberto.customer_name} telefone={aberto.customer_phone ?? ""} />}
      {aberto?.payment_status === "pago" && <p className="text-lg font-semibold text-success">Pagamento confirmado</p>}
    </DialogContent></Dialog>
  </div>;
}