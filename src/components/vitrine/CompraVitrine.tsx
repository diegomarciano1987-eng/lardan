/**
 * 0211 — Compra de verdade na vitrine: dados da cliente → Pix (QR + copia e cola) ou link do cartão → confirmação.
 * O pagamento vai para a Lardan pelo Asaas e abate no acerto da maleta da consultora; a peça fica presa ao pedido
 * por 60 minutos e, pago, a consultora só entrega.
 */
import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, CreditCard, LoaderCircle, Lock, MessageCircle, QrCode, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { vitrineComprar, type ResultadoCompra } from "@/lib/vitrine-compra.functions";
import { brl } from "@/lib/maletas";
import { linkPedidoPublico } from "@/lib/pedido-publico";

export interface LinhaCompra { variant_id: string; produto: string; detalhe: string | null; quantidade: number; preco_cents: number }

const mascaraCpf = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
};
const mascaraFone = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
};
function cpfValido(c: string) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export function CompraVitrine({ slug, linhas, total, primeiroNome, zap, onFechar, onPago }: {
  slug: string; linhas: LinhaCompra[]; total: number; primeiroNome: string; zap: string | null;
  onFechar: () => void; onPago: () => void;
}) {
  const comprar = useServerFn(vitrineComprar);
  const chave = React.useRef(crypto.randomUUID());
  const fecharRef = React.useRef<HTMLButtonElement>(null);
  const [nome, setNome] = React.useState("");
  const [fone, setFone] = React.useState("");
  const [cpf, setCpf] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [forma, setForma] = React.useState<"pix" | "cartao">("pix");
  const [res, setRes] = React.useState<ResultadoCompra | null>(null);

  React.useEffect(() => {
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    fecharRef.current?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !m.isPending) onFechar(); };
    window.addEventListener("keydown", tecla);
    return () => { document.body.style.overflow = antes; window.removeEventListener("keydown", tecla); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const m = useMutation({
    mutationFn: () => comprar({ data: { slug, chave: chave.current, forma, cliente: { nome, telefone: fone, cpf, email: email || null },
      itens: linhas.map((l) => ({ variant_id: l.variant_id, quantidade: l.quantidade })) } }),
    onSuccess: (r) => setRes(r as ResultadoCompra),
    onError: (e) => { toast.error((e as Error).message); chave.current = crypto.randomUUID(); },
  });

  const situacao = useQuery({
    queryKey: ["vitrine-pagamento", res?.token],
    enabled: !!res,
    refetchInterval: (q) => ((q.state.data as { pago?: boolean; cancelado?: boolean } | undefined)?.pago || (q.state.data as { cancelado?: boolean } | undefined)?.cancelado ? false : 5000),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("vitrine_pagamento_situacao" as never, { _token: res!.token } as never);
      if (error) throw error;
      return data as unknown as { pago: boolean; cancelado: boolean; expira_em: string | null };
    },
  });
  const pago = situacao.data?.pago === true;
  React.useEffect(() => { if (pago) onPago(); }, [pago, onPago]);

  const okNome = nome.trim().split(/\s+/).length >= 2 && nome.trim().length >= 5;
  const okFone = [10, 11].includes(fone.length);
  const okCpf = cpfValido(cpf);
  const okEmail = !email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const pronto = okNome && okFone && okCpf && okEmail && !m.isPending;
  const copiar = async (t: string) => { await navigator.clipboard.writeText(t); toast.success("Copiado!"); };
  const linkPedido = res ? linkPedidoPublico(res.token) : null;
  const avisarZap = zap && res ? `${zap}?text=${encodeURIComponent(`Olá, ${primeiroNome}! Acabei de comprar na sua vitrine o pedido ${res.codigo} (${brl(res.total_cents)}). ${linkPedido ?? ""}`)}` : null;
  const campo = "w-full rounded-lg border border-[var(--v-line)] bg-[var(--v-bg)] px-3 py-3 text-base outline-none focus:border-[var(--v-ink)]";

  return (
    <div role="dialog" aria-modal="true" aria-label="Finalizar compra" className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center">
      <div className="max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[var(--v-bg)] p-5 text-[var(--v-ink)] shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-[var(--v-muted)]">Compra com {primeiroNome}</p>
            <h2 className="mt-1 text-xl font-semibold">{pago ? "Pagamento confirmado" : res ? (res.forma === "pix" ? "Pague com Pix" : "Pague com cartão") : "Finalizar compra"}</h2>
          </div>
          <button ref={fecharRef} type="button" aria-label="Fechar" disabled={m.isPending} onClick={onFechar} className="grid size-10 place-items-center rounded-full border border-[var(--v-line)]"><X className="size-5" /></button>
        </div>

        {pago ? (
          <div className="space-y-4 text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-[var(--v-accent)] text-[var(--v-accent-ink)]"><Check className="size-8" aria-hidden /></span>
            <p className="text-lg font-semibold">Obrigada pela compra!</p>
            <p className="text-sm text-[var(--v-muted)]">Pedido {res?.codigo} · {brl(res?.total_cents ?? 0)}. {primeiroNome} já foi avisada e vai combinar a entrega com você pelo WhatsApp.</p>
            {linkPedido && <a href={linkPedido} target="_blank" rel="noreferrer" className="block rounded-lg border border-[var(--v-line)] px-4 py-3 text-sm">Ver meu pedido</a>}
            {avisarZap && <a href={avisarZap} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-lg bg-[var(--v-accent)] px-4 py-3 text-sm text-[var(--v-accent-ink)]"><MessageCircle className="size-4" aria-hidden /> Falar com {primeiroNome}</a>}
          </div>
        ) : situacao.data?.cancelado ? (
          <div className="space-y-3 text-center">
            <p className="font-semibold">O prazo para pagar terminou.</p>
            <p className="text-sm text-[var(--v-muted)]">As peças voltaram para a vitrine. Se ainda quiser, faça a compra de novo.</p>
            <button type="button" onClick={onFechar} className="w-full rounded-lg border border-[var(--v-line)] px-4 py-3 text-sm">Voltar para a vitrine</button>
          </div>
        ) : res ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--v-muted)]">Pedido {res.codigo} · <strong className="text-[var(--v-ink)]">{brl(res.total_cents)}</strong>. Suas peças ficam separadas por 60 minutos enquanto o pagamento não chega.</p>
            {res.forma === "pix" && res.qr && <img src={res.qr} alt="QR code do Pix" className="mx-auto size-60 rounded-xl border border-[var(--v-line)] bg-white p-2" />}
            {res.forma === "pix" && res.copia && <button type="button" onClick={() => copiar(res.copia!)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--v-accent)] px-4 py-3 text-sm text-[var(--v-accent-ink)]"><Copy className="size-4" aria-hidden /> Copiar Pix copia e cola</button>}
            {res.url && (res.forma === "cartao" || !res.copia) && (
              <a href={res.url} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--v-accent)] px-4 py-3 text-sm text-[var(--v-accent-ink)]">
                {res.forma === "cartao" ? <CreditCard className="size-4" aria-hidden /> : <QrCode className="size-4" aria-hidden />} {res.forma === "cartao" ? "Pagar com cartão (página segura)" : "Abrir página do Pix"}
              </a>
            )}
            <p className="flex items-center justify-center gap-2 text-sm text-[var(--v-muted)]"><LoaderCircle className="size-4 animate-spin" aria-hidden /> Aguardando a confirmação do pagamento…</p>
            <p className="flex items-center justify-center gap-1.5 text-xs text-[var(--v-muted)]"><Lock className="size-3.5" aria-hidden /> Pagamento recebido pela Lardan Semijoias (CNPJ 43.319.208/0001-80) via Asaas.</p>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (pronto) m.mutate(); }}>
            <ul className="divide-y divide-[var(--v-line)] rounded-lg border border-[var(--v-line)] text-sm">
              {linhas.map((l) => (
                <li key={l.variant_id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="min-w-0"><span className="block truncate">{l.quantidade}× {l.produto}</span>{l.detalhe && <span className="block truncate text-xs text-[var(--v-muted)]">{l.detalhe}</span>}</span>
                  <span className="shrink-0 tabular-nums">{brl(l.preco_cents * l.quantidade)}</span>
                </li>
              ))}
              <li className="flex justify-between px-3 py-2 font-semibold"><span>Total</span><span className="tabular-nums">{brl(total)}</span></li>
            </ul>
            <label className="block text-sm">Nome completo<input className={`${campo} mt-1`} autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
            <label className="block text-sm">WhatsApp<input className={`${campo} mt-1`} inputMode="tel" autoComplete="tel" placeholder="(43) 99999-9999" value={mascaraFone(fone)} onChange={(e) => setFone(e.target.value.replace(/\D/g, "").slice(0, 11))} /></label>
            <label className="block text-sm">CPF (exigido para o pagamento)<input className={`${campo} mt-1`} inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={mascaraCpf(cpf)} onChange={(e) => setCpf(e.target.value.replace(/\D/g, "").slice(0, 11))} />
              {cpf.length === 11 && !okCpf && <span className="mt-1 block text-xs text-red-600">CPF inválido. Confira os números.</span>}</label>
            <label className="block text-sm">E-mail (opcional)<input className={`${campo} mt-1`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} /></label>
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="mb-1 text-sm">Como você quer pagar?</legend>
              {(["pix", "cartao"] as const).map((f) => (
                <button key={f} type="button" aria-pressed={forma === f} onClick={() => setForma(f)}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm ${forma === f ? "border-[var(--v-ink)] font-semibold" : "border-[var(--v-line)] text-[var(--v-muted)]"}`}>
                  {f === "pix" ? <QrCode className="size-4" aria-hidden /> : <CreditCard className="size-4" aria-hidden />}{f === "pix" ? "Pix" : "Cartão de crédito"}
                </button>
              ))}
            </fieldset>
            <button type="submit" disabled={!pronto} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--v-accent)] px-4 py-3 text-sm font-semibold text-[var(--v-accent-ink)] disabled:opacity-50">
              {m.isPending ? <><LoaderCircle className="size-4 animate-spin" aria-hidden /> Gerando pagamento…</> : `Pagar ${brl(total)}`}
            </button>
            <p className="text-center text-xs text-[var(--v-muted)]">Pagamento seguro para a Lardan Semijoias. A entrega é combinada com {primeiroNome}.</p>
          </form>
        )}
      </div>
    </div>
  );
}
