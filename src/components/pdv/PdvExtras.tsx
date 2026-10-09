import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, Instagram, Phone, Plus, Search, ShoppingBag, UserRound, Save } from "lucide-react";
import { DateField } from "@/components/premium/DateField";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { maskCepInput, maskPhoneInput } from "@/lib/docs-br";
import { UFS } from "@/lib/catalog";
import { consultarCepPublico } from "@/lib/br/lookup.functions";
import { pdvClienteSalvar, pdvClientes, pdvVendas, pdvCancelar, type ClientePdv } from "@/lib/pdv.functions";

export const brl = (c: number) => (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const inp = "h-12 w-full rounded-lg border border-border bg-background px-3 text-base";
const btn = "h-12 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50";
const btn2 = "h-12 rounded-lg border border-border px-4 text-sm disabled:opacity-50";
const FORMA: Record<string, string> = { dinheiro: "Dinheiro", debito: "Débito", credito: "Crédito", pix: "Pix" };
const erro = (e: unknown) => toast.error((e as Error).message);
const dig = (v?: string) => (v ?? "").replace(/\D/g, "");

/** CPF: no máximo 11 dígitos, sempre no formato 000.000.000-00. */
export const maskCpf = (v: string) => dig(v).slice(0, 11).replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
export const clienteVazio = (): ClientePdv => ({ nome: "", doc: "", telefone: "" });

function Campo({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`flex flex-col gap-1.5 ${className}`}><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>{children}</label>;
}

const isoParaData = (v?: string) => (v ? new Date(`${v}T12:00:00`) : undefined);
const dataParaIso = (d?: Date) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "");

/** Cadastro da cliente: 3 campos rápidos + cadastro completo (Instagram, e-mail, aniversário, endereço, observações). */
export function ClienteForm({ c, set, onSalva, abrirCompleto = false }: { c: ClientePdv; set: (c: ClientePdv) => void; onSalva?: (r: { party_id: string; nome: string }) => void; abrirCompleto?: boolean }) {
  const salvar = useServerFn(pdvClienteSalvar); const cep = useServerFn(consultarCepPublico);
  const [aberto, setAberto] = React.useState(abrirCompleto); const [busy, setBusy] = React.useState(false);
  const up = (k: keyof ClientePdv, v: string) => set({ ...c, [k]: v });
  const cpfOk = !c.doc || dig(c.doc).length === 11; const telOk = !c.telefone || [10, 11].includes(dig(c.telefone).length);
  const buscarCep = async (v: string) => {
    if (dig(v).length !== 8) return;
    try { const r: any = await cep({ data: { cep: dig(v) } }); const a = r?.address ?? r?.data ?? r; if (a) set({ ...c, cep: v, rua: a.street ?? a.logradouro ?? c.rua, bairro: a.district ?? a.bairro ?? c.bairro, cidade: a.city ?? a.localidade ?? c.cidade, uf: a.uf ?? c.uf }); } catch { /* CEP manual */ }
  };
  const gravar = async () => {
    if (!c.nome.trim()) { toast.error("Informe o nome da cliente."); return; }
    if (!cpfOk || !telOk) { toast.error("Confira CPF (11 dígitos) e WhatsApp (DDD + número)."); return; }
    setBusy(true);
    try { const r = await salvar({ data: c }); set({ ...c, party_id: r.party_id }); toast.success(`Cliente ${r.nome} gravada na loja.`); onSalva?.(r); } catch (x) { erro(x); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-lg"><UserRound className="h-5 w-5 text-primary" />Cliente {c.party_id && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">gravada</span>}</h3>
        <span className="text-xs text-muted-foreground">Venda rápida: nome, CPF e WhatsApp</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Campo label="Nome completo"><input className={inp} maxLength={150} value={c.nome} onChange={(x) => up("nome", x.target.value)} placeholder="Nome da cliente" /></Campo>
        <Campo label="CPF"><input className={inp + (cpfOk ? "" : " border-destructive")} inputMode="numeric" maxLength={14} value={maskCpf(c.doc ?? "")} onChange={(x) => up("doc", maskCpf(x.target.value))} placeholder="000.000.000-00" /></Campo>
        <Campo label="WhatsApp"><input className={inp + (telOk ? "" : " border-destructive")} inputMode="tel" maxLength={15} value={maskPhoneInput(c.telefone ?? "")} onChange={(x) => up("telefone", maskPhoneInput(x.target.value))} placeholder="(00) 00000-0000" /></Campo>
      </div>
      <button type="button" onClick={() => setAberto(!aberto)} className="flex items-center gap-1 text-sm text-primary"><ChevronDown className={`h-4 w-4 transition ${aberto ? "rotate-180" : ""}`} />{aberto ? "Ocultar cadastro completo" : "Cadastro completo (Instagram, e-mail, aniversário, endereço)"}</button>
      {aberto && <div className="grid gap-3 md:grid-cols-3">
        <Campo label="Instagram"><div className="relative"><span className="absolute left-3 top-3.5 text-muted-foreground">@</span><input className={inp + " pl-7"} maxLength={30} value={c.instagram ?? ""} onChange={(x) => up("instagram", x.target.value.replace(/[^\w.]/g, ""))} placeholder="usuario" /></div></Campo>
        <Campo label="E-mail"><input className={inp} type="email" maxLength={255} value={c.email ?? ""} onChange={(x) => up("email", x.target.value)} placeholder="nome@email.com" /></Campo>
        <Campo label="Aniversário"><DateField value={isoParaData(c.nascimento)} onChange={(d) => up("nascimento", dataParaIso(d))} fromYear={1930} toYear={new Date().getFullYear()} shortcuts={false} /></Campo>
        <Campo label="CEP"><input className={inp} inputMode="numeric" maxLength={9} value={maskCepInput(c.cep ?? "")} onChange={(x) => { const v = maskCepInput(x.target.value); up("cep", v); void buscarCep(v); }} placeholder="00000-000" /></Campo>
        <Campo label="Rua" className="md:col-span-2"><input className={inp} maxLength={150} value={c.rua ?? ""} onChange={(x) => up("rua", x.target.value)} /></Campo>
        <Campo label="Número"><input className={inp} maxLength={20} value={c.numero ?? ""} onChange={(x) => up("numero", x.target.value)} /></Campo>
        <Campo label="Complemento"><input className={inp} maxLength={80} value={c.complemento ?? ""} onChange={(x) => up("complemento", x.target.value)} /></Campo>
        <Campo label="Bairro"><input className={inp} maxLength={80} value={c.bairro ?? ""} onChange={(x) => up("bairro", x.target.value)} /></Campo>
        <Campo label="Cidade" className="md:col-span-2"><input className={inp} maxLength={80} value={c.cidade ?? ""} onChange={(x) => up("cidade", x.target.value)} /></Campo>
        <Campo label="UF"><SmartSelect value={c.uf ?? ""} onChange={(v) => up("uf", v)} options={UFS.map((u: any) => ({ value: typeof u === "string" ? u : u.sigla ?? u.value, label: typeof u === "string" ? u : u.sigla ?? u.label }))} /></Campo>
        <Campo label="Observações (medida de anel, preferências)" className="md:col-span-3"><textarea className="min-h-20 w-full rounded-lg border border-border bg-background p-3 text-base" maxLength={500} value={c.observacoes ?? ""} onChange={(x) => up("observacoes", x.target.value)} /></Campo>
      </div>}
      <div className="flex justify-end"><button type="button" className={btn2 + " flex items-center gap-2"} disabled={busy || !c.nome.trim()} onClick={gravar}><Save className="h-4 w-4" />{busy ? "Gravando…" : "Gravar cliente"}</button></div>
    </section>
  );
}

/** Calculadora simples de balcão. */
export function Calculadora({ usar }: { usar?: (v: string) => void }) {
  const [vis, setVis] = React.useState("0"); const [acc, setAcc] = React.useState<number | null>(null); const [op, setOp] = React.useState<string | null>(null); const [novo, setNovo] = React.useState(true);
  const num = () => Number(vis.replace(",", "."));
  const calc = (a: number, b: number, o: string) => (o === "+" ? a + b : o === "−" ? a - b : o === "×" ? a * b : b === 0 ? 0 : a / b);
  const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
  const tecla = (k: string) => {
    if (/^\d$/.test(k)) { setVis(novo || vis === "0" ? k : (vis + k).slice(0, 12)); setNovo(false); return; }
    if (k === ",") { if (novo) { setVis("0,"); setNovo(false); } else if (!vis.includes(",")) setVis(vis + ","); return; }
    if (k === "C") { setVis("0"); setAcc(null); setOp(null); setNovo(true); return; }
    if (k === "=") { if (op && acc !== null) { setVis(fmt(calc(acc, num(), op))); setAcc(null); setOp(null); setNovo(true); } return; }
    const r = op && acc !== null && !novo ? calc(acc, num(), op) : num();
    setAcc(r); setVis(fmt(r)); setOp(k); setNovo(true);
  };
  const t = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "0", ",", "C", "+"];
  return (
    <div className="space-y-2 rounded-xl border border-border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Calculadora</p>
      <div className="rounded-lg bg-muted/50 px-3 py-2 text-right"><span className="mr-2 text-xs text-muted-foreground">{acc !== null && op ? `${fmt(acc)} ${op}` : ""}</span><span className="font-mono text-2xl">{vis}</span></div>
      <div className="grid grid-cols-4 gap-1.5">
        {t.map((k) => <button key={k} type="button" onClick={() => tecla(k)} className={`h-11 rounded-lg border text-base ${/[÷×−+]/.test(k) ? "border-primary/30 bg-primary/10 text-primary" : k === "C" ? "border-border text-destructive" : "border-border"}`}>{k}</button>)}
        <button type="button" onClick={() => tecla("=")} className="col-span-4 h-11 rounded-lg bg-primary text-primary-foreground">=</button>
      </div>
      {usar && <button type="button" className="w-full text-xs text-primary underline" onClick={() => usar(vis)}>Usar resultado no valor do pagamento</button>}
    </div>
  );
}

/** Histórico de vendas da loja em cards. */
export function Vendas({ Comprovante, ok }: { Comprovante: React.ComponentType<{ venda: string; telefone?: string }>; ok: () => void }) {
  const f = useServerFn(pdvVendas); const cancelar = useServerFn(pdvCancelar);
  const [dias, setDias] = React.useState(1); const [ver, setVer] = React.useState<string | null>(null);
  const q = useQuery({ queryKey: ["pdv-vendas", dias], queryFn: () => f({ data: { dias } }) });
  const lista = q.data ?? [];
  const concl = lista.filter((v: any) => v.status === "concluida");
  const total = concl.reduce((s: number, v: any) => s + Number(v.total), 0);
  const STATUS: Record<string, [string, string]> = { concluida: ["Concluída", "bg-primary/10 text-primary"], cancelada: ["Cancelada", "bg-destructive/10 text-destructive"], aguardando_pix: ["Aguardando Pix", "bg-muted text-muted-foreground"] };
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="font-display text-3xl">Vendas</h2><p className="text-sm text-muted-foreground">{concl.length} concluída(s) · {brl(total)}</p></div>
        <div className="flex gap-2">{[[1, "Hoje"], [7, "7 dias"], [30, "30 dias"], [90, "90 dias"]].map(([d, l]) => <button key={d} onClick={() => setDias(d as number)} className={dias === d ? btn : btn2}>{l}</button>)}</div>
      </div>
      {q.isLoading ? <p className="text-muted-foreground">Carregando…</p> : q.isError ? <p className="text-destructive">Não foi possível carregar as vendas.</p> : lista.length === 0 ? <p className="rounded-xl border border-border p-10 text-center text-muted-foreground">Sem vendas neste período.</p> :
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{lista.map((v: any) => {
          const d = new Date(v.hora); const [sl, sc] = STATUS[v.status] ?? [v.status, ""];
          return (
            <article key={v.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
              <header className="flex items-start justify-between gap-2">
                <div><p className="font-display text-xl">Venda nº {v.codigo}</p><p className="text-sm text-muted-foreground">{d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} às {d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</p></div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${sc}`}>{sl}</span>
              </header>
              <div className="space-y-0.5 text-sm"><p><span className="text-muted-foreground">Vendedora:</span> <b>{v.vendedora}</b></p>{v.cliente && <p><span className="text-muted-foreground">Cliente:</span> {v.cliente}{v.telefone && ` · ${maskPhoneInput(v.telefone)}`}</p>}</div>
              <ul className="space-y-1 border-t border-border pt-3 text-sm">{v.itens.map((i: any, k: number) => <li key={k} className="flex justify-between gap-2"><span>{i.qtd}× {i.nome}</span><span className="font-mono">{brl(i.total)}</span></li>)}</ul>
              <div className="space-y-1 border-t border-border pt-3 text-sm">
                {v.desconto > 0 && <p className="flex justify-between text-muted-foreground"><span>Desconto</span><span className="font-mono">−{brl(v.desconto)}</span></p>}
                {v.pagamentos.map((p: any, k: number) => <p key={k} className="flex justify-between text-muted-foreground"><span>{FORMA[p.forma]}{p.parcelas > 1 ? ` ${p.parcelas}x` : ""}{p.troco ? ` · troco ${brl(p.troco)}` : ""}{p.status === "pendente" ? " · aguardando" : ""}</span><span className="font-mono">{brl(p.valor)}</span></p>)}
                <p className="flex justify-between pt-1 text-lg"><span>Total</span><b className="font-mono">{brl(v.total)}</b></p>
                {v.cancel_motivo && <p className="text-xs text-destructive">Motivo: {v.cancel_motivo}</p>}
              </div>
              <footer className="mt-auto flex flex-wrap gap-3 border-t border-border pt-3 text-sm">
                <button className="text-primary underline" onClick={() => setVer(ver === v.id ? null : v.id)}>Comprovante</button>
                {v.status !== "cancelada" && <button className="text-destructive underline" onClick={async () => { const m = window.prompt("Motivo do cancelamento:"); if (!m) return; try { await cancelar({ data: { venda: v.id, motivo: m } }); toast.success("Venda cancelada e peças devolvidas ao estoque da loja."); q.refetch(); ok(); } catch (x) { erro(x); } }}>Cancelar</button>}
              </footer>
              {ver === v.id && <Comprovante venda={v.id} telefone={v.telefone} />}
            </article>);
        })}</div>}
    </div>
  );
}

/** Clientes cadastradas na loja. */
export function Clientes({ vender }: { vender: (c: ClientePdv) => void }) {
  const f = useServerFn(pdvClientes);
  const [q, setQ] = React.useState(""); const [busca, setBusca] = React.useState(""); const [nova, setNova] = React.useState<ClientePdv | null>(null);
  React.useEffect(() => { const t = setTimeout(() => setBusca(q), 300); return () => clearTimeout(t); }, [q]);
  const r = useQuery({ queryKey: ["pdv-clientes", busca], queryFn: () => f({ data: { q: busca } }) });
  const lista = r.data ?? [];
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="font-display text-3xl">Clientes da loja</h2><p className="text-sm text-muted-foreground">{lista.length} cliente(s){busca && " encontradas"}</p></div>
        <button className={btn + " flex items-center gap-2"} onClick={() => setNova(clienteVazio())}><Plus className="h-4 w-4" />Nova cliente</button>
      </div>
      {nova && <div className="space-y-2"><ClienteForm c={nova} set={setNova} abrirCompleto onSalva={() => { setNova(null); r.refetch(); }} /><button className="text-sm underline" onClick={() => setNova(null)}>Fechar</button></div>}
      <div className="relative"><Search className="absolute left-3 top-4 h-4 w-4 text-muted-foreground" /><input className={inp + " pl-9"} placeholder="Buscar por nome, CPF, WhatsApp ou @instagram" value={q} onChange={(x) => setQ(x.target.value)} /></div>
      {r.isLoading ? <p className="text-muted-foreground">Carregando…</p> : r.isError ? <p className="text-destructive">Não foi possível carregar as clientes.</p> : lista.length === 0 ? <p className="rounded-xl border border-border p-10 text-center text-muted-foreground">{busca ? "Nenhuma cliente encontrada." : "Nenhuma cliente cadastrada nesta loja ainda."}</p> :
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{lista.map((c: any) => (
          <article key={c.party_id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <div><p className="font-display text-xl">{c.nome}</p><p className="text-xs text-muted-foreground">{c.doc ? `CPF ${c.doc}` : "Sem CPF"} · cliente desde {new Date(c.desde).toLocaleDateString("pt-BR")}</p></div>
            <div className="space-y-1 text-sm">
              {c.whatsapp && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" />{maskPhoneInput(dig(String(c.whatsapp)).replace(/^55(?=\d{10,11}$)/, ""))}</p>}
              {c.instagram && <p className="flex items-center gap-2"><Instagram className="h-4 w-4 text-muted-foreground" />@{c.instagram}</p>}
              {c.email && <p className="text-muted-foreground">{c.email}</p>}
              {c.cidade && <p className="text-muted-foreground">{c.cidade}</p>}
              {c.observacoes && <p className="text-xs text-muted-foreground">{c.observacoes}</p>}
            </div>
            <div className="mt-auto flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="flex items-center gap-1 text-muted-foreground"><ShoppingBag className="h-4 w-4" />{c.compras} compra(s) · {brl(c.total)}</span>
              <button className="text-primary underline" onClick={() => vender({ party_id: c.party_id, nome: c.nome, doc: "", telefone: c.whatsapp ? dig(String(c.whatsapp)).replace(/^55(?=\d{10,11}$)/, "") : "", instagram: c.instagram ?? "", email: c.email ?? "" })}>Vender para ela</button>
            </div>
          </article>))}</div>}
    </div>
  );
}

/** Histórico de links de pagamento enviados (Pix e link de cartão Asaas) desta loja. */
export function LinksEnviados() {
  const f = useServerFn(pdvLinksEnviados);
  const [dias, setDias] = React.useState(30);
  const r = useQuery({ queryKey: ["pdv-links", dias], queryFn: () => f({ data: { dias } }) });
  const lista: any[] = r.data ?? [];
  const copiar = async (url: string) => { try { await navigator.clipboard.writeText(url); toast.success("Link copiado."); } catch { toast.error("Não consegui copiar."); } };
  const whats = (l: any) => {
    const tel = dig(String(l.telefone ?? "")).replace(/^55(?=\d{10,11}$)/, "");
    const msg = encodeURIComponent(`Olá${l.cliente ? ` ${String(l.cliente).split(" ")[0]}` : ""}! Aqui está o link de pagamento da sua compra na ${"Lardan"}: ${l.url}`);
    window.open(`https://wa.me/${tel ? `55${tel}` : ""}?text=${msg}`, "_blank", "noopener");
  };
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-display text-3xl">Links enviados</h2><p className="text-sm text-muted-foreground">{lista.length} link(s) nos últimos {dias} dias</p></div>
        <div className="flex gap-2">{[7, 30, 90].map((d) => <button key={d} onClick={() => setDias(d)} className={dias === d ? btn : btn2}>{d} dias</button>)}</div>
      </div>
      {r.isLoading ? <p className="text-muted-foreground">Carregando…</p> : r.isError ? <p className="text-destructive">Não foi possível carregar os links.</p> : lista.length === 0 ? <p className="rounded-xl border border-border p-10 text-center text-muted-foreground">Nenhum link de pagamento gerado neste período.</p> :
        <div className="space-y-3">{lista.map((l: any) => (
          <article key={l.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${l.forma === "cartao" ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-600"}`}>{l.forma === "cartao" ? "Cartão (link)" : "Pix"}</span>
                <div><p className="font-medium">Venda PDV-{l.codigo} · {brl(l.total)}</p>
                  <p className="text-xs text-muted-foreground">{new Date(l.hora).toLocaleString("pt-BR")} · {l.vendedora}{l.cliente ? ` · ${l.cliente}` : ""}</p></div>
              </div>
              <span className={`text-xs font-semibold ${l.status === "cancelada" ? "text-destructive" : l.pago ? "text-emerald-600" : "text-amber-600"}`}>{l.status === "cancelada" ? "Cancelada" : l.pago ? "Pago" : "Aguardando pagamento"}</span>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <button className={btn2} onClick={() => copiar(l.url)}>Copiar link</button>
              <a className={btn2 + " inline-flex items-center"} href={l.url} target="_blank" rel="noopener noreferrer">Abrir link</a>
              <button className={btn2} onClick={() => whats(l)}>Enviar no WhatsApp</button>
            </div>
          </article>))}</div>}
    </div>
  );
}
