import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import QRCode from "qrcode";
import { ChevronLeft, ChevronRight, Copy, MessageCircle, Plus, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateField } from "@/components/premium/DateField";
import { repCobrar } from "@/lib/representante.functions";
import { brl, dataBR, repAvulsa, repCheque, repCrm, repCrmMover, repEtapaNova, repLeadCriar, type RepCobranca } from "@/lib/representante";

type Forma = "PIX" | "BOLETO" | "CREDIT_CARD" | "CHEQUE";
const FORMAS: { id: Forma; rotulo: string; dica: string }[] = [
  { id: "PIX", rotulo: "Pix", dica: "QR na tela" },
  { id: "BOLETO", rotulo: "Boleto", dica: "com Pix junto" },
  { id: "CREDIT_CARD", rotulo: "Cartão", dica: "link até 3x" },
  { id: "CHEQUE", rotulo: "Cheque", dica: "fica em custódia" },
];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const wa = (fone: string | null | undefined, texto: string) => {
  const f = (fone ?? "").replace(/\D/g, "");
  return `https://wa.me/${f ? (f.startsWith("55") ? f : `55${f}`) : ""}?text=${encodeURIComponent(texto)}`;
};
const centavos = (s: string) => Math.round(Number(s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) * 100) || 0;
const mascaraValor = (s: string) => {
  const d = s.replace(/\D/g, "");
  if (!d) return "";
  return (Number(d) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

type Alvo = { party_id: string; display_name: string };

/**
 * Cobrança de uma parcela existente (c) ou com valor digitado (avulsa).
 * Valor digitado cria um título a receber da Lardan (ex.: acerto de maleta) e cobra no Asaas.
 */
export function CobrarParcela({ c, avulsa, rep, whatsapp, rotulo, antes }: { c?: RepCobranca; avulsa?: Alvo; rep: string; whatsapp?: string | null; rotulo?: string; antes?: () => Promise<unknown> }) {
  const alvo: Alvo = c ? { party_id: c.party_id, display_name: c.display_name } : avulsa!;
  const primeiro = alvo.display_name.split(" ")[0] ?? "";
  const [aberto, setAberto] = React.useState(false);
  const [forma, setForma] = React.useState<Forma>("PIX");
  const [valor, setValor] = React.useState("");
  const [descricao, setDescricao] = React.useState("Acerto de maleta");
  const [chave, setChave] = React.useState(() => crypto.randomUUID());
  const [res, setRes] = React.useState<{ url: string | null; copia: string | null; qr: string | null; reaproveitada: boolean; valor: number } | null>(null);
  const [qrLink, setQrLink] = React.useState<string | null>(null);
  const [ch, setCh] = React.useState({ numero: "", banco: "", agencia: "", conta: "", emitente_nome: "", emitente_doc: "", valor: "", observacao: "" });
  const [bomPara, setBomPara] = React.useState<Date | undefined>();
  const qc = useQueryClient();
  const cobrar = useServerFn(repCobrar);
  const valorCents = centavos(valor);
  const parcialDeTitulo = !!c && valorCents !== c.saldo_cents;

  const gerar = useMutation({
    mutationFn: async () => {
      if (valorCents <= 0) throw new Error("Digite o valor da cobrança.");
      await antes?.();
      let inst = c && !parcialDeTitulo ? c.installment_id : undefined;
      if (!inst) {
        const desc = c ? `${descricao || "Pagamento parcial"} — ref. título ${c.numero ?? ""}`.trim() : descricao;
        inst = await repAvulsa(alvo.party_id, valorCents, desc, chave);
      }
      const r = await cobrar({ data: { installmentId: inst, forma: forma as "PIX" | "BOLETO" | "CREDIT_CARD" } });
      return { ...r, valor: valorCents };
    },
    onSuccess: async (r) => {
      setRes(r);
      if (r.url) setQrLink(await QRCode.toDataURL(r.url, { margin: 1, width: 320 }).catch(() => null));
      toast.success(r.reaproveitada ? "Cobrança já existia: reaproveitada, nada duplicado." : "Cobrança criada no Asaas em nome da Lardan.");
      void qc.invalidateQueries({ queryKey: ["rep"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cheque = useMutation({
    mutationFn: async () => { await antes?.(); return repCheque({ ...ch, valor_cents: centavos(ch.valor), bom_para: bomPara ? iso(bomPara) : "", recebido_de_party_id: alvo.party_id,
      observacao: `${c ? `parcela ${c.numero ?? ""}` : descricao} · ${ch.observacao}`.trim() }); },
    onSuccess: () => { toast.success("Cheque registrado em custódia. A baixa é feita pelo financeiro quando compensar."); setAberto(false); void qc.invalidateQueries({ queryKey: ["rep"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const texto = (u: string, v: number) => `Olá, ${primeiro}! Segue o link para pagamento de ${brl(v)} — LARDAN: ${u}`;
  const copiar = (t: string) => { void navigator.clipboard.writeText(t); toast.success("Copiado."); };
  const campo = (k: keyof typeof ch, rot: string, ph = "", mask = false) => (
    <label className="block text-sm"><span className="mb-1 block text-xs text-muted-foreground">{rot}</span>
      <input value={ch[k]} placeholder={ph} inputMode={mask ? "numeric" : undefined} onChange={(e) => setCh({ ...ch, [k]: mask ? mascaraValor(e.target.value) : e.target.value })} className="h-11 w-full rounded-xl border border-border bg-background px-3 outline-none" /></label>
  );
  const abrir = () => { setRes(null); setQrLink(null); setValor(c ? mascaraValor(String(c.saldo_cents)) : ""); setDescricao(c ? "Pagamento parcial" : "Acerto de maleta"); setChave(crypto.randomUUID()); setAberto(true); };

  return (
    <>
      <button type="button" onClick={abrir}
        className={c ? "rounded-full bg-asaas px-3 py-1.5 text-xs font-semibold text-asaas-foreground" : "flex w-full items-center justify-center gap-2 rounded-xl bg-asaas px-4 py-3 text-sm font-semibold text-asaas-foreground"}>
        {rotulo ?? "Cobrar"}
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cobrar {primeiro}</DialogTitle>
            <DialogDescription>
              {c ? `Saldo ${brl(c.saldo_cents)} · título ${c.numero ?? "—"} · vence ${dataBR(c.vencimento)}. Digite outro valor se precisar. ` : "Digite o valor. "}
              Em nome da Lardan; a baixa é automática quando o Asaas confirmar o pagamento.
            </DialogDescription>
          </DialogHeader>
          {!res && forma !== "CHEQUE" && (
            <div className="space-y-3">
              <label className="block text-sm"><span className="mb-1 block text-xs text-muted-foreground">Valor da cobrança (R$)</span>
                <input autoFocus inputMode="numeric" value={valor} onChange={(e) => setValor(mascaraValor(e.target.value))} placeholder="0,00"
                  className="h-14 w-full rounded-xl border border-border bg-background px-4 text-2xl font-semibold tabular-nums outline-none focus:border-asaas" /></label>
              {(!c || parcialDeTitulo) && (
                <label className="block text-sm"><span className="mb-1 block text-xs text-muted-foreground">Referente a</span>
                  <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 outline-none" /></label>
              )}
              {parcialDeTitulo && (
                <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">Valor diferente do saldo: vira uma cobrança própria ligada a este título. Quando for paga, o financeiro abate do título {c?.numero ?? ""}.</p>
              )}
            </div>
          )}
          {!res && (
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="Forma">
              {FORMAS.map((f) => (
                <button key={f.id} type="button" aria-pressed={forma === f.id} onClick={() => setForma(f.id)}
                  className={`rounded-xl border px-2 py-2 text-left text-xs ${forma === f.id ? (f.id === "CHEQUE" ? "border-primary bg-primary text-primary-foreground" : "border-asaas bg-asaas text-asaas-foreground") : "border-border text-muted-foreground"}`}>
                  <span className="block font-semibold">{f.rotulo}</span><span className="opacity-80">{f.dica}</span>
                </button>
              ))}
            </div>
          )}
          {forma === "CHEQUE" && !res ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {campo("numero", "Número do cheque")}{campo("banco", "Banco")}{campo("agencia", "Agência")}{campo("conta", "Conta")}
              </div>
              {campo("emitente_nome", "Emitente (nome no cheque)", alvo.display_name)}
              {campo("emitente_doc", "CPF/CNPJ do emitente (opcional)")}
              <div className="grid grid-cols-2 gap-3">
                {campo("valor", "Valor (R$)", "0,00", true)}
                <label className="block text-sm"><span className="mb-1 block text-xs text-muted-foreground">Bom para</span>
                  <DateField value={bomPara} onChange={setBomPara} /></label>
              </div>
              {campo("observacao", "Observação (opcional)")}
              <button type="button" disabled={cheque.isPending} onClick={() => cheque.mutate()} className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {cheque.isPending ? "Registrando…" : "Registrar cheque em custódia"}
              </button>
            </div>
          ) : !res ? (
            <button type="button" disabled={gerar.isPending || valorCents <= 0} onClick={() => gerar.mutate()} className="w-full rounded-xl bg-asaas px-4 py-3 text-sm font-semibold text-asaas-foreground disabled:opacity-50">
              {gerar.isPending ? "Gerando no Asaas…" : `Gerar ${FORMAS.find((f) => f.id === forma)?.rotulo} de ${brl(valorCents)}`}
            </button>
          ) : (
            <div className="space-y-3 text-center">
              <p className="text-2xl font-semibold tabular-nums">{brl(res.valor)}</p>
              {(res.qr || qrLink) && <img src={res.qr ?? qrLink!} alt="QR Code de pagamento" className="mx-auto size-64 rounded-xl bg-white p-2" />}
              {res.copia && <p className="break-all rounded-xl bg-muted px-3 py-2 text-left text-xs">{res.copia}</p>}
              <div className="flex flex-wrap justify-center gap-2">
                {res.copia && <button type="button" className="admin-btn" onClick={() => copiar(res.copia!)}><Copy className="size-4" /> Pix copia e cola</button>}
                {res.url && <button type="button" className="admin-btn" onClick={() => copiar(res.url!)}><Copy className="size-4" /> Copiar link</button>}
                {res.url && <a className="admin-btn" target="_blank" rel="noreferrer" href={wa(whatsapp, texto(res.url, res.valor))}><MessageCircle className="size-4" /> WhatsApp</a>}
              </div>
              {!res.url && <p className="text-sm text-muted-foreground">Cobrança registrada; o link aparece após a sincronização com o Asaas.</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function NovaCandidata({ rep }: { rep: string }) {
  const [aberto, setAberto] = React.useState(false);
  const [f, setF] = React.useState({ nome: "", whatsapp: "", cidade: "", uf: "", nota: "" });
  const qc = useQueryClient();
  const salvar = useMutation({
    mutationFn: () => repLeadCriar(rep, f),
    onSuccess: () => { toast.success("Candidata no seu funil. A Lardan também já a vê como 'aguardando'."); setAberto(false); setF({ nome: "", whatsapp: "", cidade: "", uf: "", nota: "" }); void qc.invalidateQueries({ queryKey: ["rep", rep, "crm"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const fone = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 11); return d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d; };
  const inp = (k: keyof typeof f, rot: string, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}, map: (v: string) => string = (v) => v) => (
    <label className="block text-sm"><span className="mb-1 block text-xs text-muted-foreground">{rot}</span>
      <input {...extra} value={f[k]} onChange={(e) => setF({ ...f, [k]: map(e.target.value) })} className="h-11 w-full rounded-xl border border-border bg-background px-3 outline-none" /></label>
  );
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><UserPlus className="size-4" /> Nova candidata</button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nova candidata</DialogTitle><DialogDescription>Entra no seu funil e chega à Lardan como "aguardando". A aprovação é sempre da Lardan.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            {inp("nome", "Nome completo", { autoFocus: true })}
            {inp("whatsapp", "WhatsApp", { inputMode: "tel", placeholder: "(43) 99999-9999" }, fone)}
            <div className="grid grid-cols-[1fr_5rem] gap-3">{inp("cidade", "Cidade")}{inp("uf", "UF", { maxLength: 2 }, (v) => v.toUpperCase().replace(/[^A-Z]/g, ""))}</div>
            {inp("nota", "Observação (opcional)")}
            <button type="button" disabled={salvar.isPending} onClick={() => salvar.mutate()} className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{salvar.isPending ? "Salvando…" : "Salvar candidata"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Captacao({ rep }: { rep: string; espelho?: boolean }) {
  const q = useQuery({ queryKey: ["rep", rep, "crm"], queryFn: () => repCrm(rep) });
  const qc = useQueryClient();
  const [novaEtapa, setNovaEtapa] = React.useState("");
  const mover = useMutation({
    mutationFn: (a: { lead: string; etapa: string }) => repCrmMover(a.lead, a.etapa),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rep", rep, "crm"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const etapa = useMutation({
    mutationFn: () => repEtapaNova(rep, novaEtapa),
    onSuccess: () => { setNovaEtapa(""); void qc.invalidateQueries({ queryKey: ["rep", rep, "crm"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  if (!q.data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const d = q.data;
  const link = d.codigo ? `https://www.lardan.com.br/seja-lardan?rep=${d.codigo}` : null;
  const STATUS: Record<string, string> = { novo: "Aguardando Lardan", em_analise: "Em análise na Lardan", qualificado: "Qualificada", aprovado: "Aprovada pela Lardan", recusado: "Não aprovada" };
  const ORIGEM: Record<string, string> = { link: "pelo seu link", manual: "cadastrada por você", encaminhada: "enviada pela Lardan" };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5 md:p-6">
        <h2 className="text-lg font-semibold">Seu link Seja Lardan</h2>
        <p className="mt-1 text-sm text-muted-foreground">Quem se cadastrar por ele chega para a Lardan já ligada a você. A aprovação de entrada é sempre da Lardan.</p>
        {link && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-muted px-3 py-2.5 text-sm">{link}</code>
            <button type="button" className="admin-btn" onClick={() => { void navigator.clipboard.writeText(link); toast.success("Link copiado."); }}><Copy className="size-4" /> Copiar</button>
            <a className="admin-btn" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Quer ser Consultora Lardan? Faça seu cadastro: ${link}`)}`}><MessageCircle className="size-4" /> WhatsApp</a>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Funil de captação <span className="text-sm font-normal text-muted-foreground">· {d.cards.length} candidatas</span></h2>
          <NovaCandidata rep={rep} />
        </div>
        <div className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-2 md:mx-0 md:px-0">
          {d.etapas.map((e, i) => {
            const cards = d.cards.filter((c) => c.etapa_id === e.id);
            return (
              <div key={e.id} className="w-[82vw] shrink-0 snap-start rounded-2xl border border-border bg-card md:w-72">
                <div className="flex items-center justify-between rounded-t-2xl px-4 py-3" style={{ background: `color-mix(in oklab, var(--primary) ${8 + i * 6}%, transparent)` }}>
                  <span className="text-sm font-semibold">{e.nome}</span><span className="text-xs text-muted-foreground">{cards.length}</span>
                </div>
                <ul className="space-y-2 p-3">
                  {cards.length === 0 && <li className="px-1 py-3 text-xs text-muted-foreground">Sem candidatas aqui.</li>}
                  {cards.map((c) => (
                    <li key={c.lead_id} className="rounded-xl border border-border bg-background p-3">
                      <p className="font-medium">{c.nome}</p>
                      <p className="text-xs text-muted-foreground">{c.cidade} · {ORIGEM[c.origem ?? ""] ?? "enviada pela Lardan"}</p>
                      {c.nota && <p className="mt-1 text-xs">{c.nota}</p>}
                      <p className="mt-1 text-xs font-medium text-primary">{STATUS[c.status_lardan] ?? c.status_lardan}</p>
                      <div className="mt-2 flex items-center gap-1">
                        <a href={wa(c.whatsapp, `Olá, ${c.nome.split(" ")[0]}! Aqui é da Lardan.`)} target="_blank" rel="noreferrer" className="grid size-9 place-items-center rounded-full border border-border" aria-label="WhatsApp"><MessageCircle className="size-4" /></a>
                        {i > 0 && <button type="button" onClick={() => mover.mutate({ lead: c.lead_id, etapa: d.etapas[i - 1]!.id })} className="grid size-9 place-items-center rounded-full border border-border" aria-label="Voltar etapa"><ChevronLeft className="size-4" /></button>}
                        {i < d.etapas.length - 1 && <button type="button" onClick={() => mover.mutate({ lead: c.lead_id, etapa: d.etapas[i + 1]!.id })} className="ml-auto flex h-9 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">Avançar <ChevronRight className="size-4" /></button>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <div className="w-64 shrink-0 rounded-2xl border border-dashed border-border p-4">
            <p className="mb-2 text-sm font-semibold">Nova etapa</p>
            <input value={novaEtapa} onChange={(e) => setNovaEtapa(e.target.value)} placeholder="Ex.: Retornar sábado" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none" />
            <button type="button" disabled={!novaEtapa.trim() || etapa.isPending} onClick={() => etapa.mutate()} className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Plus className="size-4" /> Adicionar</button>
          </div>
        </div>
      </section>
    </div>
  );
}
