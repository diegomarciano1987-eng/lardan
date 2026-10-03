import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Store, Users, CreditCard, Tag, Package, Monitor, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";

export const Route = createFileRoute("/_authenticated/admin/pdv")({
  head: () => ({ meta: [{ title: "PDV Loja — Configuração — Painel Lardan" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: PdvConfig,
});

// tabelas novas: cliente sem tipagem estrita para não depender da geração de tipos
const db = supabase as unknown as { from: (t: string) => any; rpc: (f: string, a?: object) => any };
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const iso = (d?: Date) => (d ? d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : "");
const br = (s?: string | null) => (s ? s.split("-").reverse().join("/") : "—");
const cents = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100) || 0;
async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p; if (error) throw new Error(error.message); return data;
}

type Aba = "unidade" | "equipe" | "maquininhas" | "preco" | "estoque" | "vendas" | "historico";
const PAPEL: Record<string, string> = { operadora: "Operadora/vendedora", supervisora: "Supervisora", gestao: "Gestão" };

function PdvConfig() {
  const qc = useQueryClient();
  const unidades = useQuery({ queryKey: ["pdv", "unidades"], queryFn: () => ok<any[]>(db.from("pdv_unidades").select("id,nome,location_id,business_entity_id,conta_dinheiro_id,conta_cartao_id,conta_pix_id,regra_preco,desconto_max_operadora_pct,desconto_max_supervisora_pct,reserva_minutos,comissao_libera_em,texto_comprovante,ativo,updated_at,created_at,numero,senha_alterada_em,pix_responsavel_user_id").order("nome")) });
  const [uid, setUid] = React.useState<string>("");
  React.useEffect(() => { if (!uid && unidades.data?.[0]) setUid(unidades.data[0].id); }, [unidades.data, uid]);
  const u = unidades.data?.find((x) => x.id === uid);
  const [aba, setAba] = React.useState<Aba>("unidade");
  const refetch = () => qc.invalidateQueries({ queryKey: ["pdv"] });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="ledger-eyebrow">Loja física</p>
          <h1 className="font-display text-3xl">PDV Loja — Configuração</h1>
          <p className="text-sm text-muted-foreground">Tudo que a loja usa para vender fica aqui. Cada alteração é registrada no histórico.</p>
        </div>
        <div className="flex items-end gap-2">
        <CriarLoja onCriada={(id) => { refetch(); setUid(id); }} />
        <a href="/pdv" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm">Abrir PDV (lardan.com.br/pdv)</a>
        {(unidades.data?.length ?? 0) > 1 && (
          <SmartSelect className="w-72" value={uid} onChange={setUid} options={(unidades.data ?? []).map((x) => ({ value: x.id, label: `${x.nome}${x.numero ? " · nº " + x.numero : ""}` }))} />
        )}
        </div>
      </header>

      {unidades.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : !u ? <p className="text-sm text-muted-foreground">Sem lojas configuradas.</p> : (
        <>
          <Prontidao u={u} />
          <nav className="flex flex-wrap gap-1 border-b border-border">
            {([["unidade", "Unidade", Store], ["equipe", "Equipe, comissão e metas", Users], ["maquininhas", "Maquininhas e terminais", CreditCard], ["preco", "Preço e descontos", Tag], ["estoque", "Estoque", Package], ["vendas", "Vendas e caixas", Monitor], ["historico", "Histórico", History]] as const).map(([k, r, I]) => (
              <button key={k} onClick={() => setAba(k)} className={`inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm ${aba === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}><I className="h-4 w-4" />{r}</button>
            ))}
          </nav>
          {aba === "unidade" && <><Acesso u={u} onSaved={refetch} /><Unidade u={u} onSaved={refetch} /></>}
          {aba === "vendas" && <Vendas u={u} />}
          {aba === "equipe" && <Equipe u={u} />}
          {aba === "maquininhas" && <Maquininhas u={u} />}
          {aba === "preco" && <Preco u={u} onSaved={refetch} />}
          {aba === "estoque" && <Estoque u={u} />}
          {aba === "historico" && <Historico u={u} />}
        </>
      )}
    </div>
  );
}

function Panel({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div><h2 className="font-medium">{title}</h2>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
      {children}
    </section>
  );
}
const Campo = ({ r, children }: { r: string; children: React.ReactNode }) => <label className="block space-y-1 text-sm"><span className="text-muted-foreground">{r}</span>{children}</label>;
const inp = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm";

function Prontidao({ u }: { u: any }) {
  const q = useQuery({
    queryKey: ["pdv", "prontidao", u.id],
    queryFn: async () => {
      const [m, c, mq, t, e] = await Promise.all([
        ok<any[]>(db.from("pdv_membros").select("id,papel,vende").eq("unidade_id", u.id).eq("ativo", true)),
        ok<any[]>(db.from("pdv_comissoes").select("membro_id,vigente_ate")),
        ok<any[]>(db.from("pdv_maquininhas").select("id").eq("unidade_id", u.id).eq("ativo", true)),
        ok<any[]>(db.from("pdv_terminais").select("id").eq("unidade_id", u.id).eq("ativo", true)),
        ok<any>(db.rpc("pdv_estoque_resumo", { _unidade: u.id })),
      ]);
      const vend = m.filter((x) => x.vende);
      const comCom = vend.filter((v) => c.some((x) => x.membro_id === v.id && !x.vigente_ate)).length;
      return { vend: vend.length, sup: m.filter((x) => x.papel === "supervisora").length, comCom, mq: mq.length, t: t.length, pecas: Number(e?.pecas ?? 0) };
    },
  });
  const d = q.data;
  const itens: [string, boolean][] = d ? [
    ["Número e senha da loja", !!u.numero && !!u.senha_alterada_em],
    ["Empresa responsável", !!u.business_entity_id],
    ["Responsável pelo Pix", !!u.pix_responsavel_user_id],
    ["Contas de dinheiro, cartão e Pix", !!(u.conta_dinheiro_id && u.conta_cartao_id && u.conta_pix_id)],
    [`Vendedoras (${d.vend})`, d.vend > 0],
    [`Supervisora (${d.sup})`, d.sup > 0],
    [`Comissão definida (${d.comCom}/${d.vend})`, d.vend > 0 && d.comCom === d.vend],
    [`Maquininhas (${d.mq})`, d.mq > 0],
    [`Terminais (${d.t})`, d.t > 0],
    [`Peças na loja (${d.pecas})`, d.pecas > 0],
  ] : [];
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <p className="mb-2 text-sm font-medium">Conferência de prontidão — {u.nome}</p>
      <div className="grid gap-1 text-sm md:grid-cols-4">
        {itens.map(([r, okk]) => <span key={r} className={okk ? "text-foreground" : "text-destructive"}>{okk ? "✓" : "✕"} {r}</span>)}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Cada vendedora também precisa de um PIN (aba Equipe) para entrar no PDV.</p>
    </div>
  );
}

function Unidade({ u, onSaved }: { u: any; onSaved: () => void }) {
  const [f, setF] = React.useState(u);
  React.useEffect(() => setF(u), [u]);
  const ents = useQuery({ queryKey: ["pdv", "ents"], queryFn: () => ok<any[]>(db.from("business_entities").select("id,trade_name,legal_name").eq("is_active", true)) });
  const contas = useQuery({ queryKey: ["pdv", "contas"], queryFn: () => ok<any[]>(db.from("financial_accounts").select("id,nome,kind").eq("is_active", true).is("excluida_em", null).order("nome")) });
  const loc = useQuery({ queryKey: ["pdv", "loc", u.location_id], queryFn: () => ok<any>(db.from("locations").select("name,code").eq("id", u.location_id).single()) });
  const opC = (contas.data ?? []).map((c) => ({ value: c.id, label: c.nome, hint: c.kind }));
  const salvar = async () => {
    try {
      await ok(db.from("pdv_unidades").update({ business_entity_id: f.business_entity_id, conta_dinheiro_id: f.conta_dinheiro_id, conta_cartao_id: f.conta_cartao_id, conta_pix_id: f.conta_pix_id, texto_comprovante: f.texto_comprovante, ativo: f.ativo, updated_at: new Date().toISOString() }).eq("id", u.id));
      toast.success("Unidade salva."); onSaved();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Panel title="Unidade" hint="O estoque da loja é o local cadastrado abaixo, ligado pelo código interno (não pelo nome).">
      <div className="grid gap-4 md:grid-cols-2">
        <Campo r="Local de estoque"><div className={inp + " flex items-center bg-muted/40"}>{loc.data?.name ?? "…"}</div></Campo>
        <Campo r="Empresa responsável"><SmartSelect value={f.business_entity_id ?? ""} onChange={(v) => setF({ ...f, business_entity_id: v })} options={(ents.data ?? []).map((e) => ({ value: e.id, label: e.trade_name || e.legal_name }))} /></Campo>
        <Campo r="Conta do dinheiro (caixa)"><SmartSelect value={f.conta_dinheiro_id ?? ""} onChange={(v) => setF({ ...f, conta_dinheiro_id: v })} options={opC} /></Campo>
        <Campo r="Conta dos recebíveis de cartão"><SmartSelect value={f.conta_cartao_id ?? ""} onChange={(v) => setF({ ...f, conta_cartao_id: v })} options={opC} /></Campo>
        <Campo r="Conta do Pix (Asaas)"><SmartSelect value={f.conta_pix_id ?? ""} onChange={(v) => setF({ ...f, conta_pix_id: v })} options={opC} /></Campo>
        <Campo r="Texto no rodapé do comprovante"><input className={inp} value={f.texto_comprovante ?? ""} onChange={(e) => setF({ ...f, texto_comprovante: e.target.value })} placeholder="Ex.: Trocas em até 7 dias com este comprovante" /></Campo>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Loja ativa</label>
      <button onClick={salvar} className="h-10 rounded-lg bg-primary px-5 text-sm text-primary-foreground">Salvar unidade</button>
    </Panel>
  );
}

function Equipe({ u }: { u: any }) {
  const qc = useQueryClient();
  const k = ["pdv", "equipe", u.id];
  const q = useQuery({
    queryKey: k,
    queryFn: async () => {
      const m = await ok<any[]>(db.from("pdv_membros").select("id,unidade_id,user_id,papel,vende,ativo,created_at").eq("unidade_id", u.id).order("created_at"));
      const ids = m.map((x) => x.id);
      const [c, mt, users] = await Promise.all([
        ids.length ? ok<any[]>(db.from("pdv_comissoes").select("*").in("membro_id", ids).order("vigente_de", { ascending: false })) : [],
        ids.length ? ok<any[]>(db.from("pdv_metas").select("*").in("membro_id", ids).order("periodo_de", { ascending: false })) : [],
        ok<any[]>(db.rpc("pdv_usuarios_disponiveis")),
      ]);
      return { m, c, mt, users };
    },
  });
  const [novo, setNovo] = React.useState({ user: "", papel: "operadora" });
  const nome = (id: string) => q.data?.users.find((x) => x.user_id === id)?.nome ?? "Usuária";
  const run = async (p: PromiseLike<any>, msg: string) => { try { await ok(p); toast.success(msg); qc.invalidateQueries({ queryKey: ["pdv"] }); } catch (e) { toast.error((e as Error).message); } };

  return (
    <div className="space-y-4">
      <Panel title="Adicionar pessoa à loja" hint="Cada pessoa entra com o próprio login. Quem ainda não tem acesso deve ser convidada em Usuários e Convites.">
        <div className="flex flex-wrap items-end gap-3">
          <Campo r="Usuária"><SmartSelect className="w-80" value={novo.user} onChange={(v) => setNovo({ ...novo, user: v })} options={(q.data?.users ?? []).filter((x) => !q.data?.m.some((m) => m.user_id === x.user_id)).map((x) => ({ value: x.user_id, label: x.nome, hint: x.email }))} /></Campo>
          <Campo r="Papel"><SmartSelect className="w-56" value={novo.papel} onChange={(v) => setNovo({ ...novo, papel: v })} options={Object.entries(PAPEL).map(([value, label]) => ({ value, label }))} /></Campo>
          <button disabled={!novo.user} onClick={() => run(db.from("pdv_membros").insert({ unidade_id: u.id, user_id: novo.user, papel: novo.papel, vende: novo.papel !== "gestao" }), "Pessoa adicionada.")} className="h-10 rounded-lg bg-primary px-5 text-sm text-primary-foreground disabled:opacity-50">Adicionar</button>
          <Link to="/admin/usuarios" className="h-10 content-center text-sm underline">Convidar nova pessoa</Link>
        </div>
      </Panel>
      {(q.data?.m ?? []).length === 0 ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma pessoa na loja ainda.</p> :
        q.data!.m.map((m) => <Membro key={m.id} m={m} nome={nome(m.user_id)} com={q.data!.c.filter((x) => x.membro_id === m.id)} metas={q.data!.mt.filter((x) => x.membro_id === m.id)} run={run} />)}
    </div>
  );
}

function Membro({ m, nome, com, metas, run }: { m: any; nome: string; com: any[]; metas: any[]; run: (p: PromiseLike<any>, msg: string) => void }) {
  const [pct, setPct] = React.useState(""); const [de, setDe] = React.useState<Date | undefined>(new Date());
  const [meta, setMeta] = React.useState(""); const [mDe, setMDe] = React.useState<Date | undefined>(); const [mAte, setMAte] = React.useState<Date | undefined>();
  const atual = com.find((c) => !c.vigente_ate);
  const novaComissao = async () => {
    const p = Number(pct.replace(",", "."));
    if (!(p >= 0 && p <= 100) || pct === "" || !de) { toast.error("Informe o percentual e a data de início."); return; }
    if (atual) await ok(db.from("pdv_comissoes").update({ vigente_ate: iso(de) }).eq("id", atual.id));
    run(db.from("pdv_comissoes").insert({ membro_id: m.id, percentual: p, vigente_de: iso(de) }), "Comissão registrada. Vendas antigas mantêm a regra da época.");
    setPct("");
  };
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-medium">{nome}</p><p className="text-xs text-muted-foreground">{PAPEL[m.papel]} · {m.vende ? "vende" : "não vende"} · {m.ativo ? "ativa" : "inativa"}</p></div>
        <div className="flex gap-2 text-xs">
          <button className="rounded-lg border border-border px-3 py-2" onClick={() => { const p = window.prompt(`Novo PIN de ${nome} (4 a 6 números):`); if (p) run(db.rpc("pdv_membro_pin", { _membro: m.id, _pin: p }), "PIN definido. Informe a vendedora pessoalmente."); }}>Definir PIN</button>
          <button className="rounded-lg border border-border px-3 py-2" onClick={() => run(db.from("pdv_membros").update({ vende: !m.vende, updated_at: new Date().toISOString() }).eq("id", m.id), "Atualizado.")}>{m.vende ? "Não vende" : "Vende"}</button>
          <button className="rounded-lg border border-border px-3 py-2" onClick={() => run(db.from("pdv_membros").update({ ativo: !m.ativo, updated_at: new Date().toISOString() }).eq("id", m.id), m.ativo ? "Acesso à loja bloqueado." : "Acesso reativado.")}>{m.ativo ? "Bloquear" : "Reativar"}</button>
        </div>
      </div>
      {m.vende && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">Comissão</p>
            <p className="text-sm">{atual ? <>Atual: <b>{String(atual.percentual).replace(".", ",")}%</b> desde {br(atual.vigente_de)} (sobre o valor após desconto)</> : <span className="text-destructive">Sem comissão definida</span>}</p>
            <div className="flex items-end gap-2">
              <Campo r="Novo %"><input className={inp + " w-24"} value={pct} onChange={(e) => setPct(e.target.value)} placeholder="0,00" /></Campo>
              <Campo r="A partir de"><DateField value={de} onChange={setDe} /></Campo>
              <button onClick={novaComissao} className="h-10 rounded-lg border border-border px-4 text-sm">Definir</button>
            </div>
            {com.filter((c) => c.vigente_ate).map((c) => <p key={c.id} className="text-xs text-muted-foreground">{String(c.percentual).replace(".", ",")}% de {br(c.vigente_de)} a {br(c.vigente_ate)}</p>)}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Metas</p>
            {metas.length === 0 ? <p className="text-sm text-muted-foreground">Sem metas.</p> : metas.map((x) => <p key={x.id} className="text-sm">{br(x.periodo_de)} a {br(x.periodo_ate)}: <b className="font-mono">{brl(Number(x.meta_cents))}</b></p>)}
            <div className="flex flex-wrap items-end gap-2">
              <Campo r="Valor (R$)"><input className={inp + " w-32"} value={meta} onChange={(e) => setMeta(e.target.value)} /></Campo>
              <Campo r="De"><DateField value={mDe} onChange={setMDe} /></Campo>
              <Campo r="Até"><DateField value={mAte} onChange={setMAte} /></Campo>
              <button onClick={() => { if (!cents(meta) || !mDe || !mAte) { toast.error("Preencha valor e período."); return; } run(db.from("pdv_metas").insert({ membro_id: m.id, meta_cents: cents(meta), periodo_de: iso(mDe), periodo_ate: iso(mAte) }), "Meta registrada."); setMeta(""); }} className="h-10 rounded-lg border border-border px-4 text-sm">Adicionar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Maquininhas({ u }: { u: any }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pdv", "maq", u.id], queryFn: async () => ({
    maq: await ok<any[]>(db.from("pdv_maquininhas").select("*").eq("unidade_id", u.id).order("created_at")),
    ter: await ok<any[]>(db.from("pdv_terminais").select("*").eq("unidade_id", u.id).order("nome")),
  }) });
  const [f, setF] = React.useState({ nome: "", adquirente: "", max: "1", deb: "", cred: "" });
  const [ter, setTer] = React.useState("");
  const run = async (p: PromiseLike<any>, msg: string) => { try { await ok(p); toast.success(msg); qc.invalidateQueries({ queryKey: ["pdv"] }); } catch (e) { toast.error((e as Error).message); } };
  const num = (v: string) => (v.trim() ? Number(v.replace(",", ".")) : null);
  return (
    <div className="space-y-4">
      <Panel title="Maquininhas de cartão" hint="O pagamento na maquininha é registrado à mão pela operadora após a aprovação. Não há ligação automática com a adquirente.">
        <div className="flex flex-wrap items-end gap-3">
          <Campo r="Nome"><input className={inp + " w-44"} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Rede 01" /></Campo>
          <Campo r="Adquirente"><input className={inp + " w-40"} value={f.adquirente} onChange={(e) => setF({ ...f, adquirente: e.target.value })} placeholder="Ex.: Rede, InfinityPay" /></Campo>
          <Campo r="Máx. parcelas"><input className={inp + " w-24"} value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></Campo>
          <Campo r="Taxa débito %"><input className={inp + " w-24"} value={f.deb} onChange={(e) => setF({ ...f, deb: e.target.value })} /></Campo>
          <Campo r="Taxa crédito %"><input className={inp + " w-24"} value={f.cred} onChange={(e) => setF({ ...f, cred: e.target.value })} /></Campo>
          <button disabled={!f.nome || !f.adquirente} onClick={() => { run(db.from("pdv_maquininhas").insert({ unidade_id: u.id, nome: f.nome, adquirente: f.adquirente, max_parcelas: Number(f.max) || 1, taxa_debito_pct: num(f.deb), taxa_credito_pct: num(f.cred) }), "Maquininha adicionada."); setF({ nome: "", adquirente: "", max: "1", deb: "", cred: "" }); }} className="h-10 rounded-lg bg-primary px-5 text-sm text-primary-foreground disabled:opacity-50">Adicionar</button>
        </div>
        {(q.data?.maq ?? []).map((m) => (
          <div key={m.id} className="flex items-center justify-between border-t border-border pt-3 text-sm">
            <span><b>{m.nome}</b> · {m.adquirente} · até {m.max_parcelas}x{m.taxa_debito_pct != null && ` · débito ${m.taxa_debito_pct}%`}{m.taxa_credito_pct != null && ` · crédito ${m.taxa_credito_pct}%`} {!m.ativo && <span className="text-muted-foreground">(inativa)</span>}</span>
            <button className="text-xs underline" onClick={() => run(db.from("pdv_maquininhas").update({ ativo: !m.ativo }).eq("id", m.id), "Atualizado.")}>{m.ativo ? "Desativar" : "Reativar"}</button>
          </div>
        ))}
      </Panel>
      <Panel title="Terminais (caixas)" hint="Um terminal por notebook ou tablet. Cada um abre o seu próprio caixa.">
        <div className="flex items-end gap-3">
          <Campo r="Nome"><input className={inp + " w-56"} value={ter} onChange={(e) => setTer(e.target.value)} placeholder="Ex.: Caixa 1" /></Campo>
          <button disabled={!ter.trim()} onClick={() => { run(db.from("pdv_terminais").insert({ unidade_id: u.id, nome: ter.trim() }), "Terminal criado."); setTer(""); }} className="h-10 rounded-lg bg-primary px-5 text-sm text-primary-foreground disabled:opacity-50"><Monitor className="mr-1 inline h-4 w-4" />Adicionar</button>
        </div>
        {(q.data?.ter ?? []).map((t) => (
          <div key={t.id} className="flex items-center justify-between border-t border-border pt-3 text-sm">
            <span>{t.nome} {!t.ativo && <span className="text-muted-foreground">(inativo)</span>}</span>
            <button className="text-xs underline" onClick={() => run(db.from("pdv_terminais").update({ ativo: !t.ativo }).eq("id", t.id), "Atualizado.")}>{t.ativo ? "Desativar" : "Reativar"}</button>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function Preco({ u, onSaved }: { u: any; onSaved: () => void }) {
  const [f, setF] = React.useState(u);
  React.useEffect(() => setF(u), [u]);
  const salvar = async () => {
    try {
      await ok(db.from("pdv_unidades").update({ regra_preco: f.regra_preco, desconto_max_operadora_pct: Number(String(f.desconto_max_operadora_pct).replace(",", ".")), desconto_max_supervisora_pct: Number(String(f.desconto_max_supervisora_pct).replace(",", ".")), reserva_minutos: Number(f.reserva_minutos), comissao_libera_em: f.comissao_libera_em, updated_at: new Date().toISOString() }).eq("id", u.id));
      toast.success("Regras salvas."); onSaved();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Panel title="Preço, descontos e regras da venda" hint="O preço nunca é calculado a partir do custo. Produto não precisa estar publicado no site para ser vendido na loja.">
      <div className="grid gap-4 md:grid-cols-2">
        <Campo r="Qual preço vale na loja">
          <SmartSelect value={f.regra_preco} onChange={(v) => setF({ ...f, regra_preco: v })} options={[
            { value: "preco_venda", label: "Preço de venda do cadastro", hint: "Mesmo preço cadastrado no produto" },
            { value: "preco_loja", label: "Preço especial de loja", hint: "Usa o preço de loja quando cadastrado; sem ele, a peça não é vendida" },
          ]} />
        </Campo>
        <Campo r="Quando a comissão é liberada">
          <SmartSelect value={f.comissao_libera_em} onChange={(v) => setF({ ...f, comissao_libera_em: v })} options={[
            { value: "venda_concluida", label: "Na venda concluída" },
            { value: "recebivel_liquidado", label: "Quando o dinheiro entra (cartão liquidado)" },
          ]} />
        </Campo>
        <Campo r="Desconto máximo da operadora (%)"><input className={inp} value={f.desconto_max_operadora_pct} onChange={(e) => setF({ ...f, desconto_max_operadora_pct: e.target.value })} /></Campo>
        <Campo r="Desconto máximo com aprovação da supervisora (%)"><input className={inp} value={f.desconto_max_supervisora_pct} onChange={(e) => setF({ ...f, desconto_max_supervisora_pct: e.target.value })} /></Campo>
        <Campo r="Reserva das peças durante o pagamento (minutos)"><input className={inp} value={f.reserva_minutos} onChange={(e) => setF({ ...f, reserva_minutos: e.target.value })} /></Campo>
      </div>
      <button onClick={salvar} className="h-10 rounded-lg bg-primary px-5 text-sm text-primary-foreground">Salvar regras</button>
    </Panel>
  );
}

function Estoque({ u }: { u: any }) {
  const q = useQuery({ queryKey: ["pdv", "estoque", u.id], queryFn: () => ok<any>(db.rpc("pdv_estoque_resumo", { _unidade: u.id })) });
  return (
    <Panel title="Estoque da loja" hint="A entrada e a transferência de peças usam as telas normais do Estoque, escolhendo este local como destino.">
      <div className="grid grid-cols-2 gap-3 md:w-1/2">
        <div className="rounded-xl border border-border p-4"><p className="text-xs text-muted-foreground">Peças disponíveis</p><p className="font-mono text-2xl tabular-nums">{q.data?.pecas ?? "…"}</p></div>
        <div className="rounded-xl border border-border p-4"><p className="text-xs text-muted-foreground">Produtos diferentes</p><p className="font-mono text-2xl tabular-nums">{q.data?.skus ?? "…"}</p></div>
      </div>
      <Link to="/admin/estoque" className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm text-primary-foreground">Abrir Estoque para transferir peças</Link>
    </Panel>
  );
}

function Historico({ u }: { u: any }) {
  const q = useQuery({ queryKey: ["pdv", "hist", u.id], queryFn: () => ok<any[]>(db.from("pdv_config_eventos").select("*").eq("unidade_id", u.id).order("created_at", { ascending: false }).limit(200)) });
  const T: Record<string, string> = { pdv_unidades: "Unidade", pdv_membros: "Equipe", pdv_comissoes: "Comissão", pdv_metas: "Meta", pdv_maquininhas: "Maquininha", pdv_terminais: "Terminal" };
  return (
    <Panel title="Histórico de alterações">
      {(q.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Sem alterações.</p> : q.data!.map((e) => (
        <p key={e.id} className="border-t border-border pt-2 text-sm">{new Date(e.created_at).toLocaleString("pt-BR")} · {T[e.tabela] ?? e.tabela} · {e.acao === "INSERT" ? "criado" : "alterado"}</p>
      ))}
    </Panel>
  );
}

function CriarLoja({ onCriada }: { onCriada: (id: string) => void }) {
  const [aberto, setAberto] = React.useState(false);
  const [f, setF] = React.useState({ nome: "", numero: "", senha: "" });
  const criar = async () => {
    try { const id = await ok<string>(db.rpc("pdv_unidade_criar", { _nome: f.nome, _numero: f.numero, _senha: f.senha })); toast.success(`Loja nº ${f.numero} criada com local de estoque próprio.`); setAberto(false); setF({ nome: "", numero: "", senha: "" }); onCriada(id); }
    catch (e) { toast.error((e as Error).message); }
  };
  if (!aberto) return <button onClick={() => setAberto(true)} className="h-10 rounded-lg bg-primary px-4 text-sm text-primary-foreground">Criar loja</button>;
  return (
    <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-3">
      <Campo r="Nome"><input className={inp + " w-48"} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Campo>
      <Campo r="Número"><input className={inp + " w-28"} inputMode="numeric" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value.replace(/\D/g, "") })} placeholder="12026" /></Campo>
      <Campo r="Senha da loja"><input className={inp + " w-40"} type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} /></Campo>
      <button onClick={criar} className="h-10 rounded-lg bg-primary px-4 text-sm text-primary-foreground">Criar</button>
      <button onClick={() => setAberto(false)} className="h-10 px-2 text-sm underline">cancelar</button>
    </div>
  );
}

function Acesso({ u, onSaved }: { u: any; onSaved: () => void }) {
  const [numero, setNumero] = React.useState(u.numero ?? ""); const [senha, setSenha] = React.useState("");
  const [resp, setResp] = React.useState(u.pix_responsavel_user_id ?? "");
  React.useEffect(() => { setNumero(u.numero ?? ""); setResp(u.pix_responsavel_user_id ?? ""); }, [u.id]);
  const users = useQuery({ queryKey: ["pdv", "usuarios"], queryFn: () => ok<any[]>(db.rpc("pdv_usuarios_disponiveis")) });
  const salvar = async () => {
    try {
      await ok(db.rpc("pdv_unidade_acesso", { _unidade: u.id, _numero: numero, _senha: senha }));
      await ok(db.from("pdv_unidades").update({ pix_responsavel_user_id: resp || null, updated_at: new Date().toISOString() }).eq("id", u.id));
      toast.success(senha ? "Acesso salvo. Aparelhos conectados foram desligados e precisam da nova senha." : "Acesso salvo."); setSenha(""); onSaved();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Panel title="Acesso do PDV" hint="O aparelho da loja entra em lardan.com.br/pdv (ou /loja) com o número e a senha. Depois cada vendedora escolhe o nome e digita o PIN dela — a comissão vai para quem atendeu.">
      <div className="grid gap-4 md:grid-cols-3">
        <Campo r="Número da loja"><input className={inp} inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value.replace(/\D/g, ""))} placeholder="12026" /></Campo>
        <Campo r={u.senha_alterada_em ? `Nova senha (atual definida em ${new Date(u.senha_alterada_em).toLocaleDateString("pt-BR")})` : "Senha da loja (ainda não definida)"}><input className={inp} type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="mínimo 6 caracteres" /></Campo>
        <Campo r="Responsável pelo Pix (precisa poder emitir cobranças)"><SmartSelect value={resp} onChange={setResp} options={(users.data ?? []).map((x) => ({ value: x.user_id, label: x.nome, hint: x.email }))} /></Campo>
      </div>
      <button onClick={salvar} className="h-10 rounded-lg bg-primary px-5 text-sm text-primary-foreground">Salvar acesso</button>
    </Panel>
  );
}

function Vendas({ u }: { u: any }) {
  const q = useQuery({
    queryKey: ["pdv", "vendas", u.id],
    queryFn: async () => {
      const [v, c, m, users] = await Promise.all([
        ok<any[]>(db.from("pdv_vendas").select("id,codigo,status,total_cents,desconto_cents,comissao_cents,comissao_pct,membro_id,created_at,cliente_nome").eq("unidade_id", u.id).order("created_at", { ascending: false }).limit(200)),
        ok<any[]>(db.from("pdv_caixas").select("*").eq("unidade_id", u.id).order("aberto_em", { ascending: false }).limit(30)),
        ok<any[]>(db.from("pdv_membros").select("id,user_id").eq("unidade_id", u.id)),
        ok<any[]>(db.rpc("pdv_usuarios_disponiveis")),
      ]);
      const nome = (mid: string) => { const uid = m.find((x) => x.id === mid)?.user_id; return users.find((x) => x.user_id === uid)?.nome ?? "—"; };
      return { v, c, nome };
    },
  });
  const d = q.data; const conc = (d?.v ?? []).filter((x) => x.status === "concluida");
  const porV = new Map<string, { t: number; c: number; n: number }>();
  conc.forEach((x) => { const k = d!.nome(x.membro_id); const a = porV.get(k) ?? { t: 0, c: 0, n: 0 }; a.t += Number(x.total_cents); a.c += Number(x.comissao_cents ?? 0); a.n++; porV.set(k, a); });
  return (
    <div className="space-y-4">
      <Panel title="Por vendedora (últimas 200 vendas)">
        {porV.size === 0 ? <p className="text-sm text-muted-foreground">Sem vendas.</p> : [...porV].map(([k, a]) => <p key={k} className="text-sm">{k}: {a.n} vendas · <b className="font-mono">{brl(a.t)}</b> · comissão <b className="font-mono">{brl(a.c)}</b></p>)}
      </Panel>
      <Panel title="Caixas">
        {(d?.c ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nenhum caixa aberto ainda.</p> : d!.c.map((c) => (
          <p key={c.id} className="border-t border-border pt-2 text-sm">{new Date(c.aberto_em).toLocaleString("pt-BR")} · {c.status === "aberto" ? "aberto" : `fechado · esperado ${brl(Number(c.esperado_cents))} · contado ${brl(Number(c.contado_cents))}${Number(c.contado_cents) !== Number(c.esperado_cents) ? ` · diferença ${brl(Number(c.contado_cents) - Number(c.esperado_cents))}${c.observacao ? " (" + c.observacao + ")" : ""}` : ""}`}</p>))}
      </Panel>
      <Panel title="Vendas">
        {(d?.v ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Sem vendas.</p> : d!.v.map((x) => (
          <p key={x.id} className="border-t border-border pt-2 text-sm">nº {x.codigo} · {new Date(x.created_at).toLocaleString("pt-BR")} · {d!.nome(x.membro_id)} · {x.status} · <b className="font-mono">{brl(Number(x.total_cents))}</b>{x.comissao_cents != null && ` · comissão ${brl(Number(x.comissao_cents))}`}</p>))}
      </Panel>
    </div>
  );
}
