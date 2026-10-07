import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, CreditCard, Clock, MessageCircle, QrCode, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { consultoraCobrancaGerar } from "@/lib/consultora-pagamento.functions";
import { DateField } from "@/components/premium/DateField";
import { linkWhats } from "@/lib/consultora";

type Forma = "pix" | "cartao" | "depois";
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mascaraCpf = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
};
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const somarDias = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const OPCOES: { id: Forma; titulo: string; dica: string; icone: typeof QrCode }[] = [
  { id: "pix", titulo: "Pix agora", dica: "QR code e copia e cola da Lardan", icone: QrCode },
  { id: "cartao", titulo: "Cartão de crédito", dica: "Link seguro: a cliente paga no celular dela", icone: CreditCard },
  { id: "depois", titulo: "Receber depois", dica: "Link com vencimento: Pix, boleto ou cartão", icone: Clock },
];

export function PagamentoLardan({ pedido, total, cliente, telefone }: { pedido: string; total: number; cliente: string; telefone: string }) {
  const gerar = useServerFn(consultoraCobrancaGerar);
  const [forma, setForma] = React.useState<Forma | null>(null);
  const [cpf, setCpf] = React.useState("");
  const [venc, setVenc] = React.useState(somarDias(hoje(), 7));
  const [res, setRes] = React.useState<Awaited<ReturnType<typeof consultoraCobrancaGerar>> | null>(null);

  const situacao = useQuery({
    queryKey: ["consultora-pagamento", pedido],
    enabled: !!res,
    refetchInterval: (q) => ((q.state.data as { status?: string } | undefined)?.status === "pago" ? false : 8000),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("consultora_pagamento_situacao" as never, { _order: pedido } as never);
      if (error) throw error;
      return data as { status: string };
    },
  });

  const m = useMutation({
    mutationFn: () => gerar({ data: { pedido, forma: forma!, cpf, vencimento: forma === "depois" ? venc : null } }),
    onSuccess: (r) => setRes(r),
    onError: (e) => toast.error((e as Error).message),
  });

  const primeiro = cliente.split(" ")[0];
  const textoWhats = res
    ? res.forma === "pix" && res.copia
      ? `Olá, ${primeiro}! Segue o Pix da Lardan Semijoias de ${brl(total)}. Copie e cole no app do seu banco:\n\n${res.copia}`
      : `Olá, ${primeiro}! Segue o link seguro da Lardan Semijoias para pagar ${brl(total)}${res.forma === "depois" ? ` até ${new Date(res.vencimento + "T12:00:00").toLocaleDateString("pt-BR")}` : ""}:\n${res.url ?? ""}`
    : "";
  const whats = res ? linkWhats(telefone, textoWhats) : null;
  const copiar = async (t: string) => { await navigator.clipboard.writeText(t); toast.success("Copiado!"); };

  if (situacao.data?.status === "pago") {
    return (
      <div className="rounded-3xl border border-primary/40 bg-card p-6 text-center">
        <span className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-acao text-acao-foreground"><Check className="size-7" aria-hidden /></span>
        <p className="text-lg font-semibold">Pagamento recebido pela Lardan</p>
        <p className="mt-1 text-[0.98rem] text-muted-foreground">{brl(total)} já conta no acerto da sua maleta.</p>
      </div>
    );
  }

  if (res) {
    return (
      <div className="space-y-4 rounded-3xl border border-border bg-card p-5">
        <p className="text-lg font-semibold">{res.forma === "pix" ? "Pix gerado" : res.forma === "cartao" ? "Link do cartão gerado" : "Cobrança para depois gerada"}</p>
        {res.forma === "pix" && res.qr && <img src={res.qr} alt="QR code do Pix" className="mx-auto size-64 rounded-xl border border-border bg-background p-2" />}
        {res.forma === "pix" && res.copia && (
          <button type="button" className="btn-app-principal w-full" onClick={() => copiar(res.copia!)}><Copy className="size-5" aria-hidden /> Copiar Pix copia e cola</button>
        )}
        {res.url && res.forma !== "pix" && (
          <button type="button" className="btn-app-principal w-full" onClick={() => copiar(res.url!)}><Copy className="size-5" aria-hidden /> Copiar link de pagamento</button>
        )}
        {res.forma === "pix" && !res.copia && res.url && (
          <a className="admin-btn min-h-13 w-full justify-center text-base" href={res.url} target="_blank" rel="noreferrer">Abrir página do Pix</a>
        )}
        {whats && (
          <a className="admin-btn min-h-13 w-full justify-center text-base" href={whats} target="_blank" rel="noreferrer"><MessageCircle className="size-5" aria-hidden /> Enviar para {primeiro} no WhatsApp</a>
        )}
        <p className="text-center text-[0.95rem] text-muted-foreground">Aguardando pagamento… a tela avisa sozinha quando o Asaas confirmar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-3xl border border-border bg-card p-5">
      <div>
        <p className="text-lg font-semibold">Como a cliente vai pagar?</p>
        <p className="text-[0.98rem] text-muted-foreground">Pagamento direto para a Lardan. O valor abate no acerto da sua maleta.</p>
      </div>
      <div className="grid gap-2">
        {OPCOES.map((o) => (
          <button key={o.id} type="button" aria-pressed={forma === o.id} onClick={() => setForma(o.id)}
            className={`flex items-center gap-3 rounded-2xl border p-4 text-left ${forma === o.id ? "border-primary bg-primary/10" : "border-border"}`}>
            <o.icone className="size-6 shrink-0 text-primary" aria-hidden />
            <span><span className="block text-[1.05rem] font-semibold">{o.titulo}</span><span className="block text-[0.95rem] text-muted-foreground">{o.dica}</span></span>
          </button>
        ))}
      </div>
      {forma && (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[1rem] font-medium">CPF da cliente</span>
            <input inputMode="numeric" autoComplete="off" value={mascaraCpf(cpf)} onChange={(e) => setCpf(e.target.value.replace(/\D/g, "").slice(0, 11))}
              placeholder="000.000.000-00" className="admin-input min-h-13 w-full text-[1.05rem]" />
          </label>
          {forma === "depois" && (
            <div>
              <span className="mb-1 block text-[1rem] font-medium">Vencimento</span>
              <DateField value={venc} onChange={(v) => setVenc(v || somarDias(hoje(), 7))} />
            </div>
          )}
          <button type="button" className="btn-app-principal w-full" disabled={cpf.length !== 11 || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Gerando…" : `Gerar cobrança de ${brl(total)}`}
          </button>
        </div>
      )}
    </div>
  );
}
