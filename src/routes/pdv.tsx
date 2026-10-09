import * as React from "react";
import { FotoPeca } from "@/components/FotoPeca";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import QRCode from "qrcode";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { LogOut, Search, Trash2, Printer, MessageCircle, Lock, Wallet, Receipt, Users, ShoppingCart, Link2 } from "lucide-react";
import { ClienteForm, Calculadora, Vendas, Clientes, LinksEnviados, clienteVazio } from "@/components/pdv/PdvExtras";
import { abrirCupom } from "@/components/pdv/cupom";
import {
  pdvEntrarIniciar, pdvEntrarConfirmar, pdvSair, pdvEstado, pdvOperadora, pdvOperadoraSair, pdvCaixaAbrir, pdvCaixaMov, pdvCaixaFechar,
  pdvBuscar, pdvConcluir, pdvPixGerar, pdvPixSituacao, pdvCancelar, pdvComprovante, pdvClienteSalvar, pdvVendaVincularCliente, type PagamentoPdv, type ClientePdv,
} from "@/lib/pdv.functions";

export const Route = createFileRoute("/pdv")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "PDV Loja Lardan — Frente de caixa" },
      { name: "description", content: "Frente de caixa das lojas Lardan: acesso pelo número da loja." },
      { property: "og:title", content: "PDV Loja Lardan" },
      { property: "og:description", content: "Frente de caixa das lojas Lardan." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PdvPage,
});

const brl = (c: number) => (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const cents = (v: string) => Math.round(Number(String(v).replace(/\./g, "").replace(",", ".")) * 100) || 0;
const inp = "h-12 w-full rounded-lg border border-border bg-background px-3 text-base";
const btn = "h-12 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50";
const btn2 = "h-12 rounded-lg border border-border px-4 text-sm disabled:opacity-50";
const FORMA: Record<string, string> = { dinheiro: "Dinheiro", debito: "Débito", credito: "Crédito", pix: "Pix", link_cartao: "Link cartão" };
const erro = (e: unknown) => toast.error((e as Error).message);

function PdvPage() {
  const estadoFn = useServerFn(pdvEstado);
  const q = useQuery({ queryKey: ["pdv-loja"], queryFn: () => estadoFn(), refetchInterval: 30000 });
  if (q.isLoading) return <Tela><p className="text-muted-foreground">Carregando…</p></Tela>;
  if (!q.data) return <Entrar />;
  return <Loja e={q.data} />;
}

function Tela({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-background p-6">{children}</main>;
}

function Entrar() {
  const qc = useQueryClient(); const ini = useServerFn(pdvEntrarIniciar); const conf = useServerFn(pdvEntrarConfirmar);
  const [numero, setNumero] = React.useState(""); const [senha, setSenha] = React.useState(""); const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [desafio, setDesafio] = React.useState<{ desafio: string; email: string } | null>(null);
  const [codigo, setCodigo] = React.useState(""); const [espera, setEspera] = React.useState(0);
  React.useEffect(() => { if (espera <= 0) return; const t = setTimeout(() => setEspera(espera - 1), 1000); return () => clearTimeout(t); }, [espera]);
  const pedir = async (ev?: React.FormEvent) => {
    ev?.preventDefault(); setBusy(true);
    try { setDesafio(await ini({ data: { numero, senha, email } })); setCodigo(""); setEspera(60); toast.success("Código enviado para o seu e-mail."); } catch (e) { erro(e); } finally { setBusy(false); }
  };
  const confirmar = async (ev: React.FormEvent) => {
    ev.preventDefault(); if (!desafio) return; setBusy(true);
    try { await conf({ data: { desafio: desafio.desafio, codigo } }); qc.invalidateQueries({ queryKey: ["pdv-loja"] }); } catch (e) { erro(e); setCodigo(""); } finally { setBusy(false); }
  };
  if (desafio) return (
    <Tela>
      <form onSubmit={confirmar} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-8">
        <div><p className="ledger-eyebrow">Lardan</p><h1 className="font-display text-3xl">Código de confirmação</h1><p className="text-sm text-muted-foreground">Enviamos um código de 6 dígitos para <b>{desafio.email}</b>. Ele vale por 10 minutos.</p></div>
        <input aria-label="Código" className={inp + " text-center text-2xl tracking-[0.5em]"} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} autoFocus />
        <button disabled={busy || codigo.length !== 6} className={btn + " w-full"}>{busy ? "Conferindo…" : "Confirmar e entrar"}</button>
        <div className="flex justify-between text-sm">
          <button type="button" className="text-muted-foreground underline" onClick={() => setDesafio(null)}>Voltar</button>
          <button type="button" disabled={espera > 0 || busy} className="underline disabled:no-underline disabled:text-muted-foreground" onClick={() => pedir()}>{espera > 0 ? `Reenviar em ${espera}s` : "Reenviar código"}</button>
        </div>
      </form>
    </Tela>
  );
  return (
    <Tela>
      <form onSubmit={pedir} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-8">
        <div><p className="ledger-eyebrow">Lardan</p><h1 className="font-display text-3xl">PDV da loja</h1><p className="text-sm text-muted-foreground">Digite o número da loja, a senha criada pela gestão e o seu e-mail. Você vai receber um código para entrar.</p></div>
        <label className="block space-y-1 text-sm"><span>Número da loja</span><input className={inp} inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} autoFocus /></label>
        <label className="block space-y-1 text-sm"><span>Senha da loja</span><input className={inp} type="password" value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
        <label className="block space-y-1 text-sm"><span>Seu e-mail</span><input className={inp} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <button disabled={busy || !numero || !senha || !email.includes("@")} className={btn + " w-full"}>{busy ? "Enviando…" : "Receber código"}</button>
      </form>
    </Tela>
  );
}

function Loja({ e }: { e: any }) {
  const qc = useQueryClient(); const sair = useServerFn(pdvSair); const opSair = useServerFn(pdvOperadoraSair);
  const recarregar = () => qc.invalidateQueries({ queryKey: ["pdv-loja"] });
  const [tela, setTela] = React.useState<"venda" | "vendas" | "clientes" | "caixa" | "links">("venda");
  const [cliPre, setCliPre] = React.useState<ClientePdv | null>(null);
  return (
    <div className="min-h-screen bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3">
        <div><p className="font-display text-xl">{e.unidade.nome} <span className="text-sm text-muted-foreground">nº {e.unidade.numero}</span></p>
          <p className="text-xs text-muted-foreground">{e.caixa ? `Caixa aberto por ${e.caixa.aberto_por}` : "Caixa fechado"}</p></div>
        <div className="flex items-center gap-2">
          {e.operadora && <>
            <button onClick={() => setTela("venda")} className={tela === "venda" ? btn : btn2}><ShoppingCart className="mr-1 inline h-4 w-4" />Venda</button>
            <button onClick={() => setTela("vendas")} className={tela === "vendas" ? btn : btn2}><Receipt className="mr-1 inline h-4 w-4" />Vendas</button>
            <button onClick={() => setTela("clientes")} className={tela === "clientes" ? btn : btn2}><Users className="mr-1 inline h-4 w-4" />Clientes</button>
            <button onClick={() => setTela("caixa")} className={tela === "caixa" ? btn : btn2}><Wallet className="mr-1 inline h-4 w-4" />Caixa</button>
            <button onClick={() => setTela("links")} className={tela === "links" ? btn : btn2}><Link2 className="mr-1 inline h-4 w-4" />Links</button>
            <button onClick={async () => { await opSair(); recarregar(); }} className={btn2}><Lock className="mr-1 inline h-4 w-4" />{e.operadora.nome} · trocar</button>
          </>}
          <button onClick={async () => { await sair(); recarregar(); }} className={btn2} title="Desconectar este aparelho"><LogOut className="h-4 w-4" /></button>
        </div>
      </header>
      {!e.operadora ? <EscolherVendedora e={e} ok={recarregar} /> : !e.caixa ? <AbrirCaixa ok={recarregar} /> : tela === "caixa" ? <Caixa e={e} ok={recarregar} /> : tela === "vendas" ? <Vendas Comprovante={Comprovante} ok={recarregar} /> : tela === "clientes" ? <Clientes vender={(c) => { setCliPre(c); setTela("venda"); }} /> : tela === "links" ? <LinksEnviados /> : <Venda e={e} ok={recarregar} pre={cliPre} limparPre={() => setCliPre(null)} />}
    </div>
  );
}

function EscolherVendedora({ e, ok }: { e: any; ok: () => void }) {
  const f = useServerFn(pdvOperadora);
  const [m, setM] = React.useState<any>(null); const [pin, setPin] = React.useState("");
  const go = async (ev: React.FormEvent) => { ev.preventDefault(); try { await f({ data: { membro: m.id, pin } }); setPin(""); ok(); } catch (x) { erro(x); setPin(""); } };
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h2 className="font-display text-2xl">Quem vai atender?</h2>
      {e.membros.length === 0 && <p className="text-muted-foreground">Nenhuma vendedora vinculada a esta loja. A gestão adiciona em PDV Loja → Equipe.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        {e.membros.map((x: any) => (
          <button key={x.id} onClick={() => setM(x)} className={`rounded-xl border p-5 text-left ${m?.id === x.id ? "border-primary bg-primary/5" : "border-border"}`}>
            <p className="font-medium">{x.nome}</p><p className="text-xs text-muted-foreground">{x.papel === "operadora" ? "Vendedora" : "Supervisora"}{!x.tem_pin && " · sem PIN"}</p>
          </button>
        ))}
      </div>
      {m && <form onSubmit={go} className="flex max-w-sm gap-2"><input className={inp} type="password" inputMode="numeric" maxLength={6} placeholder="PIN" value={pin} onChange={(x) => setPin(x.target.value.replace(/\D/g, ""))} autoFocus /><button className={btn} disabled={pin.length < 4}>Entrar</button></form>}
    </div>
  );
}

function AbrirCaixa({ ok }: { ok: () => void }) {
  const f = useServerFn(pdvCaixaAbrir); const [v, setV] = React.useState("");
  return (
    <div className="mx-auto max-w-sm space-y-4 p-8">
      <h2 className="font-display text-2xl">Abrir caixa</h2>
      <label className="block space-y-1 text-sm"><span>Fundo de troco na gaveta (R$)</span><input className={inp} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder="0,00" /></label>
      <button className={btn + " w-full"} onClick={async () => { try { await f({ data: { fundo: cents(v) } }); ok(); } catch (e) { erro(e); } }}>Abrir caixa</button>
    </div>
  );
}

function Caixa({ e, ok }: { e: any; ok: () => void }) {
  const mov = useServerFn(pdvCaixaMov); const fechar = useServerFn(pdvCaixaFechar);
  const [tipo, setTipo] = React.useState<"sangria" | "suprimento">("sangria"); const [v, setV] = React.useState(""); const [mot, setMot] = React.useState("");
  const [cont, setCont] = React.useState(""); const [obs, setObs] = React.useState(""); const [res, setRes] = React.useState<any>(null);
  const c = e.caixa;
  if (res) return (
    <div className="mx-auto max-w-md space-y-3 p-8"><h2 className="font-display text-2xl">Caixa fechado</h2>
      <p>Esperado: <b>{brl(res.esperado)}</b></p><p>Contado: <b>{brl(res.contado)}</b></p><p>Diferença: <b className={res.diferenca ? "text-destructive" : ""}>{brl(res.diferenca)}</b></p>
      <button className={btn} onClick={ok}>Continuar</button></div>
  );
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-8 md:grid-cols-2">
      <section className="space-y-2 rounded-xl border border-border p-6">
        <h2 className="font-medium">Resumo do caixa</h2>
        <p className="text-sm">Fundo: {brl(c.fundo)} · Vendas concluídas: {c.vendas}</p>
        {Object.entries(c.por_forma ?? {}).map(([k, t]) => <p key={k} className="text-sm">{FORMA[k]}: <b>{brl(t as number)}</b></p>)}
        <p className="pt-2 text-lg">Dinheiro esperado na gaveta: <b>{brl(c.esperado)}</b></p>
      </section>
      <section className="space-y-3 rounded-xl border border-border p-6">
        <h2 className="font-medium">Sangria / suprimento</h2>
        <div className="flex gap-2">{(["sangria", "suprimento"] as const).map((t) => <button key={t} onClick={() => setTipo(t)} className={tipo === t ? btn : btn2}>{t === "sangria" ? "Sangria (retirar)" : "Suprimento (colocar)"}</button>)}</div>
        <input className={inp} placeholder="Valor (R$)" inputMode="decimal" value={v} onChange={(x) => setV(x.target.value)} />
        <input className={inp} placeholder="Motivo" value={mot} onChange={(x) => setMot(x.target.value)} />
        <button className={btn} onClick={async () => { try { await mov({ data: { tipo, valor: cents(v), motivo: mot } }); setV(""); setMot(""); toast.success("Registrado."); ok(); } catch (x) { erro(x); } }}>Registrar</button>
      </section>
      <section className="space-y-3 rounded-xl border border-border p-6 md:col-span-2">
        <h2 className="font-medium">Fechar caixa</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <input className={inp} placeholder="Dinheiro contado (R$)" inputMode="decimal" value={cont} onChange={(x) => setCont(x.target.value)} />
          <input className={inp + " md:col-span-2"} placeholder="Observação (obrigatória se houver diferença)" value={obs} onChange={(x) => setObs(x.target.value)} />
        </div>
        <button className={btn} onClick={async () => { try { setRes(await fechar({ data: { contado: cents(cont), obs } })); } catch (x) { erro(x); } }}>Fechar caixa</button>
      </section>
      <VendasHoje e={e} ok={ok} />
    </div>
  );
}

type Item = { variant_id: string; nome: string; sku: string; preco: number; qtd: number; saldo: number };

function Venda({ e, ok, pre, limparPre }: { e: any; ok: () => void; pre: ClientePdv | null; limparPre: () => void }) {
  const buscar = useServerFn(pdvBuscar); const concluir = useServerFn(pdvConcluir); const salvarCli = useServerFn(pdvClienteSalvar); const vincular = useServerFn(pdvVendaVincularCliente);
  const [q, setQ] = React.useState(""); const [res, setRes] = React.useState<any[]>([]);
  const [itens, setItens] = React.useState<Item[]>([]); const [desc, setDesc] = React.useState("");
  const [cli, setCli] = React.useState<ClientePdv>(clienteVazio());
  React.useEffect(() => { if (pre) { setCli(pre); limparPre(); } }, [pre]);
  const [pags, setPags] = React.useState<PagamentoPdv[]>([]);
  const [forma, setForma] = React.useState<PagamentoPdv["forma"]>("dinheiro"); const [val, setVal] = React.useState(""); const [rec, setRec] = React.useState("");
  const [maq, setMaq] = React.useState(e.maquininhas[0]?.id ?? ""); const [parc, setParc] = React.useState("1"); const [nsu, setNsu] = React.useState("");
  const [idem, setIdem] = React.useState(() => crypto.randomUUID()); const [busy, setBusy] = React.useState(false);
  const [feita, setFeita] = React.useState<any>(null);
  const sub = itens.reduce((s, i) => s + i.preco * i.qtd, 0); const dc = cents(desc); const tot = Math.max(sub - dc, 0);
  const pago = pags.reduce((s, p) => s + p.valor_cents, 0); const falta = tot - pago;
  const limite = e.operadora.papel === "operadora" ? e.unidade.desc_operadora : e.unidade.desc_supervisora;

  const add = (r: any) => {
    if (!r.preco) { toast.error("Peça sem preço cadastrado."); return; }
    setItens((xs) => { const f = xs.find((x) => x.variant_id === r.id); if (f) return xs.map((x) => x === f ? { ...x, qtd: x.qtd + 1 } : x); return [...xs, { variant_id: r.id, nome: r.nome, sku: r.sku, preco: Number(r.preco), qtd: 1, saldo: Number(r.saldo) }]; });
    setQ(""); setRes([]);
  };
  const seq = React.useRef(0);
  const procurar = async (ev?: React.FormEvent) => {
    ev?.preventDefault(); if (q.trim().length < 2) return;
    const n = ++seq.current;
    try { const r = await buscar({ data: { q } }); if (n !== seq.current) return; if (r.length === 1 && r[0].exato) add(r[0]); else setRes(r); if (!r.length) toast.message("Nenhuma peça encontrada."); } catch (x) { erro(x); }
  };
  // Busca enquanto digita (nome/referência); Enter do leitor continua imediato.
  React.useEffect(() => {
    const t = q.trim();
    if (t.length < 3 || /^\d{6,}$/.test(t)) { if (t.length < 2) setRes([]); return; }
    const h = setTimeout(async () => { const n = ++seq.current; try { const r = await buscar({ data: { q: t } }); if (n === seq.current) setRes(r); } catch { /* silencioso */ } }, 300);
    return () => clearTimeout(h);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const addPag = () => {
    const v = cents(val) || falta; if (v <= 0) return;
    if (v > falta) { toast.error("Valor maior que o que falta."); return; }
    const p: PagamentoPdv = { forma, valor_cents: v };
    if (forma === "dinheiro") p.recebido_cents = cents(rec) || v;
    if (forma === "debito" || forma === "credito") { if (!maq) { toast.error("Escolha a maquininha."); return; } p.maquininha_id = maq; p.parcelas = forma === "credito" ? Number(parc) : 1; p.nsu = nsu; }
    setPags([...pags, p]); setVal(""); setRec(""); setNsu("");
  };
  const fechar = async () => {
    setBusy(true);
    try {
      const d = (v?: string) => (v ?? "").replace(/\D/g, "");
      if (cli.doc && d(cli.doc).length !== 11) throw new Error("CPF deve ter 11 dígitos.");
      if (cli.telefone && ![10, 11].includes(d(cli.telefone).length)) throw new Error("WhatsApp deve ter DDD + número.");
      // Toda venda com nome grava/atualiza a cliente da loja antes de concluir.
      let party = cli.party_id;
      if (cli.nome.trim()) { const g = await salvarCli({ data: cli }); party = g.party_id; setCli({ ...cli, party_id: party }); }
      const r: any = await concluir({ data: { idem, itens: itens.map((i) => ({ variant_id: i.variant_id, qtd: i.qtd })), desconto_cents: dc, cliente: { nome: cli.nome, doc: d(cli.doc), telefone: d(cli.telefone) }, pagamentos: pags } });
      if (party && r?.venda) await vincular({ data: { venda: r.venda, party } }).catch(() => undefined);
      setFeita({ ...r, telefone: d(cli.telefone), online: pags.find((p) => p.forma === "pix" || p.forma === "link_cartao")?.forma ?? "pix" }); ok();
    } catch (x) { erro(x); } finally { setBusy(false); }
  };
  const nova = () => { setItens([]); setDesc(""); setCli(clienteVazio()); setPags([]); setIdem(crypto.randomUUID()); setFeita(null); };
  const cancelarVenda = useServerFn(pdvCancelar);
  // Volta ao carrinho para trocar a forma de pagamento: cancela a venda que ficou
  // aguardando Pix/link (sem pagamento confirmado) e mantém peças, cliente e pagamentos.
  const voltar = async () => {
    if (feita?.status === "aguardando_pix" && feita?.venda) {
      try { await cancelarVenda({ data: { venda: feita.venda, motivo: "troca da forma de pagamento" } }); }
      catch (x) { erro(x); return; }
    }
    setIdem(crypto.randomUUID()); setFeita(null);
  };

  if (feita) return <Finalizada v={feita} nova={nova} ok={ok} voltar={voltar} />;
  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[1fr_420px]">
      <section className="space-y-4">
        <form onSubmit={procurar} className="flex gap-2">
          <div className="relative flex-1"><Search className="absolute left-3 top-4 h-4 w-4 text-muted-foreground" /><input className={inp + " pl-9"} autoFocus placeholder="Bipe o código de barras, ou digite a referência (ex.: AN4668) ou o nome da peça" value={q} onChange={(x) => setQ(x.target.value)} /></div>
          <button className={btn}>Buscar</button>
        </form>
        {res.length > 0 && <div className="divide-y divide-border rounded-xl border border-border">{res.map((r) => (
          <button key={r.id} onClick={() => add(r)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/40">
            <span className="flex items-center gap-3"><FotoPeca variantId={r.id} alt={r.nome} /><span><span className="block text-sm">{r.nome}</span><span className="text-xs text-muted-foreground">{r.sku} · {r.saldo} na loja</span></span></span>
            <b className="font-mono">{r.preco ? brl(r.preco) : "sem preço"}</b></button>))}</div>}
        <div className="rounded-xl border border-border">
          {itens.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma peça no carrinho.</p> : itens.map((i) => (
            <div key={i.variant_id} className="flex items-center gap-3 border-b border-border p-3 last:border-0">
              <FotoPeca variantId={i.variant_id} alt={i.nome} size="md" />
              <div className="flex-1"><p className="text-sm">{i.nome}</p><p className="text-xs text-muted-foreground">{i.sku} · {brl(i.preco)} {i.qtd > i.saldo && <span>· vem do depósito na venda</span>}</p></div>
              <input className="h-10 w-16 rounded-lg border border-border bg-background text-center" type="number" min={1} value={i.qtd} onChange={(x) => setItens(itens.map((y) => y === i ? { ...y, qtd: Math.max(1, Number(x.target.value) || 1) } : y))} />
              <b className="w-24 text-right font-mono">{brl(i.preco * i.qtd)}</b>
              <button onClick={() => setItens(itens.filter((y) => y !== i))} aria-label="Remover"><Trash2 className="h-4 w-4 text-muted-foreground" /></button>
            </div>))}
        </div>
        <ClienteForm c={cli} set={setCli} />
      </section>
      <aside className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="space-y-1 text-sm">
          <p className="flex justify-between"><span>Subtotal</span><b className="font-mono">{brl(sub)}</b></p>
          <label className="flex items-center justify-between gap-2"><span>Desconto (até {String(limite).replace(".", ",")}%)</span><input className="h-10 w-28 rounded-lg border border-border bg-background px-2 text-right" inputMode="decimal" value={desc} onChange={(x) => setDesc(x.target.value)} placeholder="0,00" /></label>
          <p className="flex justify-between pt-2 text-2xl"><span>Total</span><b className="font-mono">{brl(tot)}</b></p>
        </div>
        <div className="space-y-2 border-t border-border pt-3">
          <div className="grid grid-cols-5 gap-1">{(["dinheiro", "debito", "credito", "pix", "link_cartao"] as const).map((f) => <button key={f} onClick={() => setForma(f)} disabled={(f === "pix" || f === "link_cartao") && !e.unidade.pix} title={f === "link_cartao" ? "Link de cartão de crédito pelo Asaas, para a cliente pagar no celular" : undefined} className={`h-11 rounded-lg border text-sm ${forma === f ? "border-primary bg-primary text-primary-foreground" : "border-border"} disabled:opacity-40`}>{FORMA[f]}</button>)}</div>
          {(forma === "pix" || forma === "link_cartao") && !e.unidade.pix && <p className="text-xs text-muted-foreground">Falta escolher o responsável pelo Pix da loja em PDV Loja → Acesso.</p>}
          {forma === "link_cartao" && <p className="text-xs text-muted-foreground">Gera um link do Asaas para a cliente pagar no cartão de crédito pelo celular. Débito continua na maquininha.</p>}
          <input className={inp} placeholder={`Valor (falta ${brl(falta)})`} inputMode="decimal" value={val} onChange={(x) => setVal(x.target.value)} />
          {forma === "dinheiro" && <input className={inp} placeholder="Recebido em dinheiro (para troco)" inputMode="decimal" value={rec} onChange={(x) => setRec(x.target.value)} />}
          {(forma === "debito" || forma === "credito") && <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3"><SmartSelect value={maq} onChange={setMaq} options={e.maquininhas.map((m: any) => ({ value: m.id, label: m.nome }))} /></div>
            {forma === "credito" && <input className={inp} placeholder="Parcelas" inputMode="numeric" value={parc} onChange={(x) => setParc(x.target.value.replace(/\D/g, ""))} />}
            <input className={inp + (forma === "credito" ? " col-span-2" : " col-span-3")} placeholder="NSU / autorização" value={nsu} onChange={(x) => setNsu(x.target.value)} />
          </div>}
          <button className={btn2 + " w-full"} disabled={falta <= 0 || itens.length === 0} onClick={addPag}>Adicionar pagamento</button>
          {pags.map((p, i) => <p key={i} className="flex justify-between text-sm"><span>{FORMA[p.forma]}{p.parcelas && p.parcelas > 1 ? ` ${p.parcelas}x` : ""}{p.recebido_cents && p.recebido_cents > p.valor_cents ? ` · troco ${brl(p.recebido_cents - p.valor_cents)}` : ""}</span><span><b className="font-mono">{brl(p.valor_cents)}</b> <button onClick={() => setPags(pags.filter((_, j) => j !== i))} className="ml-2 text-xs underline">tirar</button></span></p>)}
        </div>
        <button className={btn + " w-full text-base"} disabled={busy || itens.length === 0 || falta !== 0} onClick={fechar}>{busy ? "Finalizando…" : falta > 0 ? `Falta ${brl(falta)}` : "Finalizar venda"}</button>
        <Calculadora usar={(v) => setVal(v)} />
      </aside>
      <div className="lg:col-span-2"><VendasHoje e={e} ok={ok} /></div>
    </div>
  );
}

function Finalizada({ v, nova, ok, voltar }: { v: any; nova: () => void; ok: () => void; voltar: () => void }) {
  const gerar = useServerFn(pdvPixGerar); const sit = useServerFn(pdvPixSituacao);
  const [status, setStatus] = React.useState<string>(v.status);
  const [pix, setPix] = React.useState<{ url: string | null; copia: string | null; qr: string | null; forma: string } | null>(null);
  const [img, setImg] = React.useState(""); const [busy, setBusy] = React.useState(false); const [aberto, setAberto] = React.useState(false);
  const cartao = (pix?.forma ?? v.online) === "link_cartao";
  React.useEffect(() => {
    if (!pix) return;
    if (pix.qr) setImg(pix.qr.startsWith("data:") ? pix.qr : `data:image/png;base64,${pix.qr}`);
    else { const alvo = pix.copia ?? pix.url; if (alvo) QRCode.toDataURL(alvo, { width: 420, margin: 1 }).then(setImg); }
  }, [pix]);
  React.useEffect(() => {
    if (status !== "aguardando_pix" || !pix) return;
    const t = setInterval(async () => { try { const r = await sit({ data: { venda: v.venda } }); if (r.status !== "aguardando_pix") { setStatus(r.status); setAberto(false); ok(); } } catch { /* tenta de novo */ } }, 5000);
    return () => clearInterval(t);
  }, [status, pix]);
  const gerarPix = async () => {
    if (pix) { setAberto(true); return; }
    setBusy(true);
    try { const r: any = await gerar({ data: { venda: v.venda } }); if (!r.url && !r.copia) throw new Error("O Asaas não devolveu a cobrança."); setPix({ url: r.url ?? null, copia: r.copia ?? null, qr: r.qr ?? null, forma: r.forma ?? "pix" }); setAberto(true); }
    catch (x) { erro(x); } finally { setBusy(false); }
  };
  const textoPix = cartao ? (pix?.url ?? "") : (pix?.copia ?? pix?.url ?? "");
  const copiar = async () => { try { await navigator.clipboard.writeText(textoPix); toast.success(cartao ? "Link copiado. Cole no WhatsApp da cliente." : "Pix copiado. Cole no WhatsApp da cliente."); } catch { toast.error("Não foi possível copiar."); } };
  const tel = (v.telefone ?? "").replace(/\D/g, "");
  const msgWhats = cartao
    ? `Link para pagar sua compra Lardan no cartão de crédito (venda nº ${v.codigo}):\n\n${textoPix}`
    : `Pix da sua compra Lardan (venda nº ${v.codigo}). Copie e cole no app do seu banco:\n\n${textoPix}`;
  return (
    <div className="mx-auto max-w-lg space-y-4 p-8 text-center">
      <h2 className="font-display text-3xl">Venda nº {v.codigo}</h2>
      {status === "aguardando_pix" ? (
        <button className={btn} disabled={busy} onClick={gerarPix}>{busy ? (cartao ? "Gerando link…" : "Gerando Pix…") : pix ? (cartao ? "Mostrar link do cartão" : "Mostrar Pix") : (cartao ? "Gerar link de cartão (Asaas)" : "Gerar Pix (Asaas)")}</button>
      ) : status === "concluida" ? <p className="text-lg">Venda concluída.</p> : <p>Situação: {status}</p>}
      <Comprovante venda={v.venda} telefone={v.telefone} />
      <button className={btn} onClick={nova}>Nova venda</button>
      {aberto && pix && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 p-4" role="dialog" aria-label={cartao ? "Link de cartão da venda" : "Pix da venda"}>
          <div className="w-full max-w-xl space-y-4 rounded-2xl bg-background p-8 shadow-2xl">
            <div className="flex items-start justify-between"><div className="text-left"><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{cartao ? "Cartão de crédito · Asaas" : "Pix Lardan · Asaas"}</p><h3 className="font-display text-3xl">Venda nº {v.codigo}</h3></div><button className={btn2} onClick={() => setAberto(false)}>Fechar</button></div>
            {img ? <img src={img} alt={cartao ? "QR Code do link de pagamento" : "QR Code do Pix"} className="mx-auto w-full max-w-[360px] rounded-xl border border-border bg-background p-2" /> : <p>Gerando QR…</p>}
            <p className="text-sm text-muted-foreground">{cartao ? "A cliente aponta a câmera para o QR ou abre o link no celular e paga no cartão de crédito. A venda conclui sozinha quando o Asaas confirmar." : "A cliente aponta a câmera do celular ou o app do banco para o QR. A venda conclui sozinha quando o Asaas confirmar."}</p>
            {textoPix && <div className="break-all rounded-lg border border-border bg-muted p-3 text-left font-mono text-xs">{textoPix}</div>}
            <div className="grid grid-cols-2 gap-2">
              <button className={btn} onClick={copiar}>{cartao ? "Copiar link" : "Copiar Pix (copia e cola)"}</button>
              <button className={btn2} onClick={() => window.open(`https://wa.me/${tel ? (tel.length <= 11 ? "55" + tel : tel) : ""}?text=${encodeURIComponent(msgWhats)}`, "_blank")}><MessageCircle className="mr-1 inline h-4 w-4" />Enviar no WhatsApp</button>
            </div>
            <p className="animate-pulse text-sm">Aguardando confirmação do Asaas…</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Comprovante({ venda, telefone }: { venda: string; telefone?: string }) {
  const f = useServerFn(pdvComprovante);
  const dados = async () => (await f({ data: { venda } })) as any;
  const imprimir = async (formato: "termica" | "a4") => { try { abrirCupom(await dados(), formato); } catch (x) { erro(x); } };
  const whats = async () => {
    try {
      const c = await dados();
      const l = [`*Lardan · ${c.loja}*`, `Comprovante nº ${c.codigo}`, new Date(c.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), `Atendimento: ${c.vendedora}`, "",
        ...(c.itens ?? []).map((i: any) => `${i.qtd}x ${i.nome} — ${brl(i.total)}`), "",
        `Subtotal: ${brl(c.subtotal)}`, ...(c.desconto ? [`Desconto: ${brl(c.desconto)}`] : []), `*Total: ${brl(c.total)}*`,
        ...(c.pagamentos ?? []).map((p: any) => `${FORMA[p.forma]}${p.parcelas > 1 ? ` ${p.parcelas}x` : ""}: ${brl(p.valor)}${p.troco ? ` (troco ${brl(p.troco)})` : ""}`),
        "", "Obrigada pela preferência! Documento sem valor fiscal."];
      const tel = (telefone ?? "").replace(/\D/g, "");
      window.open(`https://wa.me/${tel ? (tel.length <= 11 ? "55" + tel : tel) : ""}?text=${encodeURIComponent(l.join("\n"))}`, "_blank");
    } catch (x) { erro(x); }
  };
  return <div className="flex flex-wrap justify-center gap-2"><button className={btn2} onClick={() => imprimir("termica")}><Printer className="mr-1 inline h-4 w-4" />Cupom (térmica)</button><button className={btn2} onClick={() => imprimir("a4")}><Receipt className="mr-1 inline h-4 w-4" />A4 / PDF</button><button className={btn2} onClick={whats}><MessageCircle className="mr-1 inline h-4 w-4" />WhatsApp</button></div>;
}

function VendasHoje({ e, ok }: { e: any; ok: () => void }) {
  const cancelar = useServerFn(pdvCancelar);
  const [ver, setVer] = React.useState<string | null>(null);
  if (!e.hoje?.length) return null;
  return (
    <section className="rounded-xl border border-border p-4 md:col-span-2">
      <h3 className="mb-2 text-sm font-medium">Vendas de hoje</h3>
      {e.hoje.map((v: any) => (
        <div key={v.id} className="flex flex-wrap items-center gap-3 border-t border-border py-2 text-sm">
          <span className="w-16 font-mono">nº {v.codigo}</span><span className="w-14">{new Date(v.hora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
          <span className="flex-1">{v.vendedora}</span>
          <span className={v.status === "cancelada" ? "text-destructive" : v.status === "aguardando_pix" ? "text-muted-foreground" : ""}>{v.status === "concluida" ? "Concluída" : v.status === "cancelada" ? "Cancelada" : v.online === "link_cartao" ? "Aguardando cartão" : "Aguardando Pix"}</span>
          <b className="w-24 text-right font-mono">{brl(v.total)}</b>
          <button className="text-xs underline" onClick={() => setVer(ver === v.id ? null : v.id)}>comprovante</button>
          {v.status !== "cancelada" && <button className="text-xs text-destructive underline" onClick={async () => { const m = window.prompt("Motivo do cancelamento:"); if (!m) return; try { await cancelar({ data: { venda: v.id, motivo: m } }); toast.success("Venda cancelada e peças devolvidas ao estoque da loja."); ok(); } catch (x) { erro(x); } }}>cancelar</button>}
          {ver === v.id && <div className="w-full"><Comprovante venda={v.id} /></div>}
        </div>))}
    </section>
  );
}
