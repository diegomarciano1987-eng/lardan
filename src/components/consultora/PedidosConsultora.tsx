import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, MessageCircle, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PagamentoLardan } from "@/components/consultora/PagamentoLardan";
import { brl, detalhePedido, listarPedidos, mudarSituacaoPedido, SITUACAO_PEDIDO, traduzir, type PedidoResumo } from "@/lib/maletas";
import { linkWhats } from "@/lib/consultora";
import { idadePedido, mensagemPedido, tomIdade } from "@/lib/consultora-regras";

const GRUPOS = ["Atendendo", "Aguardando pagamento", "Pagos", "Cancelados"] as const;
function grupo(p: PedidoResumo) {
  if (p.status === "cancelado") return "Cancelados";
  if (p.payment_status === "pago") return "Pagos";
  return p.status === "aguardando_pagamento" ? "Aguardando pagamento" : "Atendendo";
}
export function PedidosConsultora() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["consultora", "pedidos"], queryFn: () => listarPedidos() });
  const [aba, setAba] = React.useState<typeof GRUPOS[number]>("Atendendo");
  const [cancelar, setCancelar] = React.useState<PedidoResumo | null>(null);
  const [aberto, setAberto] = React.useState<PedidoResumo | null>(null);
  const detalhe = useQuery({ queryKey: ["consultora", "pedido", aberto?.id], queryFn: () => aberto ? detalhePedido(aberto.id) : Promise.resolve(null), enabled: !!aberto });
  const mudar = useMutation({ mutationFn: (v: { id: string; status: string }) => mudarSituacaoPedido(v.id, v.status), onSuccess: () => { setCancelar(null); toast.success("Pedido atualizado."); void qc.invalidateQueries({ queryKey: ["consultora"] }); }, onError: (e) => toast.error(traduzir(e)) });
  if (q.isLoading) return <p role="status">Carregando pedidos…</p>;
  if (q.isError) return <p role="alert">{traduzir(q.error)}</p>;
  const lista = q.data ?? [];
  return <div className="space-y-5">
    <p className="text-lg">Pedido combinado não confirma pagamento nem reserva peças.</p>
    <div role="tablist" aria-label="Situação dos pedidos" className="grid grid-cols-2 gap-2 lg:grid-cols-4">{GRUPOS.map((g) => {
      const itens = lista.filter((p) => grupo(p) === g);
      return <Button key={g} type="button" role="tab" aria-selected={aba === g} variant={aba === g ? "default" : "outline"} className="h-auto min-h-20 flex-col whitespace-normal px-3 py-3" onClick={() => setAba(g)}><span>{g} ({itens.length})</span><strong>{brl(itens.reduce((s, p) => s + Number(p.subtotal_cents), 0))}</strong></Button>;
    })}</div>
    {lista.filter((p) => grupo(p) === aba).length === 0 && <p className="border-y border-border py-8 text-center">Sem pedidos nesta situação.</p>}
    <ul className="space-y-3">{lista.filter((p) => grupo(p) === aba).map((p) => {
      const dias = idadePedido(p.created_at); const tom = tomIdade(dias);
      const cor = tom === "success" ? "bg-success/15 text-success" : tom === "warning" ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive";
      const whats = p.customer_phone ? linkWhats(p.customer_phone, mensagemPedido(p)) : null;
      return <li key={p.id} className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-xl font-semibold">{p.customer_name}</h2><p className="mt-1">{p.code} · {p.items_count} peças · {brl(Number(p.subtotal_cents))}</p><p className="mt-1">{new Date(p.created_at).toLocaleDateString("pt-BR")} · {SITUACAO_PEDIDO[p.status]?.rotulo}</p></div>
          {!["concluido", "cancelado"].includes(p.status) && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-12 shrink-0" aria-label={`Mais ações do pedido ${p.code}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem className="min-h-12 text-lg" onSelect={() => setCancelar(p)}>Cancelar pedido</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
        </div>
        <span className={`mt-3 inline-block rounded px-3 py-1 text-lg font-semibold ${cor}`}>Há {dias} {dias === 1 ? "dia" : "dias"}</span>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="outline" className="h-auto min-h-12" onClick={() => setAberto(p)}><ShoppingBag /> Ver peças e pagamento</Button>
          {whats && <Button asChild variant="outline" className="h-auto min-h-12"><a href={whats} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</a></Button>}
          {p.status === "aguardando_atendimento" && <Button className="h-auto min-h-12" disabled={mudar.isPending} onClick={() => mudar.mutate({ id: p.id, status: "em_atendimento" })}>Começar atendimento</Button>}
          {p.status === "em_atendimento" && <Button className="h-auto min-h-12" disabled={mudar.isPending} onClick={() => mudar.mutate({ id: p.id, status: "aguardando_pagamento" })}>Combinar pagamento</Button>}
        </div>
      </li>;
    })}</ul>
    <Dialog open={!!cancelar} onOpenChange={(v) => { if (!v) setCancelar(null); }}><DialogContent><DialogHeader><DialogTitle>Cancelar {cancelar?.code}?</DialogTitle><DialogDescription>O pedido será cancelado. O histórico fica preservado e reservas existentes serão liberadas.</DialogDescription></DialogHeader><div className="flex gap-3"><Button variant="outline" onClick={() => setCancelar(null)}>Voltar</Button><Button variant="destructive" disabled={mudar.isPending} onClick={() => { if (cancelar) mudar.mutate({ id: cancelar.id, status: "cancelado" }); }}>Confirmar cancelamento</Button></div></DialogContent></Dialog>
    <Dialog open={!!aberto} onOpenChange={(v) => { if (!v) setAberto(null); }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Pedido {aberto?.code}</DialogTitle><DialogDescription>{aberto?.customer_name}</DialogDescription></DialogHeader>
      {detalhe.isLoading && <p>Carregando peças…</p>}{detalhe.isError && <p role="alert">{traduzir(detalhe.error)}</p>}
      <ul className="divide-y divide-border">{detalhe.data?.itens.map((i) => <li key={i.id} className="py-3 text-lg">{i.quantity}× {i.product_name} · {i.variant_label} · {brl(i.unit_price_cents * i.quantity)}</li>)}</ul>
      {aberto && !["cancelado"].includes(aberto.status) && aberto.payment_status !== "pago" && <PagamentoLardan pedido={aberto.id} total={aberto.subtotal_cents} cliente={aberto.customer_name} telefone={aberto.customer_phone ?? ""} />}
      {aberto?.payment_status === "pago" && <p className="text-lg font-semibold text-success">Pagamento confirmado</p>}
    </DialogContent></Dialog>
  </div>;
}