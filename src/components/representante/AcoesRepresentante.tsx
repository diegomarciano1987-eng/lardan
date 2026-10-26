import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import QRCode from "qrcode";
import { ChevronLeft, ChevronRight, Copy, Lock, MessageCircle, PhoneCall, Plus, Printer, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateField } from "@/components/premium/DateField";
import { repCobrar } from "@/lib/representante.functions";
import {
  brl, dataBR, repCheque, repCobHistorico, repCobPromessa, repCobRegistrar, repCobrancaParcial, repCrm, repCrmMover, repDinheiroReceber, repEtapaNova, repLeadCriar,
  type Recibo, type RepCobranca, type ResultadoContato, type TipoContato,
} from "@/lib/representante";
import { imprimirRecibo, textoReciboWhatsApp } from "@/lib/recibo-representante";

type Forma = "LINK" | "DINHEIRO" | "CHEQUE";
const FORMAS: { id: Forma; rotulo: string; dica: string }[] = [
  { id: "LINK", rotulo: "Link de cobrança", dica: "Pix, boleto ou cartão" },
  { id: "DINHEIRO", rotulo: "Recebi em dinheiro", dica: "gera recibo" },
  { id: "CHEQUE", rotulo: "Cheque", dica: "fica em custódia" },
];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const wa = (fone: string | null | undefined, texto: string) => {
  const f = (fone ?? "").replace(/\D/g, "");
  return `https://wa.me/${f ? (f.startsWith("55") ? f : `55${f}`) : ""}?text=${encodeURIComponent(texto)}`;
};
const centavos = (s: string) => Math.round(Number(s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) * 100) || 0;
export const mascaraValor = (s: string) => {
  const d = s.replace(/\D/g, "");
  if (!d) return "";
  return (Number(d) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Cobrança SEMPRE de uma parcela em aberto (0160): valor até o saldo.
 * Link: valor cheio cobra a própria parcela; valor menor vira cobrança parcial ligada a ela.
 * Dinheiro: baixa na conta "Retido Representante" e recibo para imprimir/enviar.
 * Cheque: custódia (baixa pelo financeiro quando compensar).
 */
export function CobrarParcela({ c, rep, whatsapp, rotulo, antes }: { c: RepCobranca; rep: string; whatsapp?: string | null; rotulo?: string; antes?: (() => Promise<unknown>) | undefined }) {
  const primeiro = c.display_name.split(" ")[0] ?? "";
  const [aberto, setAberto] = React.useState(false);
  const [forma, setForma] = React.useState<Forma>("LINK");
  const [valor, setValor] = React.useState("");
  const [obs, setObs] = React.useState("");
  const [chave, setChave] = React.useState(() => crypto.randomUUID());
  const [res, setRes] = React.useState<{ url: string | null; copia: string | null; qr: string | null; reaproveitada: boolean; valor: number } | null>(null);
  const [recibo, setRecibo] = React.useState<Recibo | null>(null);
  const [qrLink, setQrLink] = React.useState<string | null>(null);
  const [ch, setCh] = React.useState({ numero: "", banco: "", agencia: "", conta: "", emitente_nome: "", emitente_doc: "", valor: "", observacao: "" });
  const [bomPara, setBomPara] = React.useState<Date | undefined>();
  const qc = useQueryClient();
  const cobrar = useServerFn(repCobrar);
  const valorCents = centavos(valor);
  const acimaDoSaldo = valorCents > c.saldo_cents;
  const recarregar = () => void qc.invalidateQueries({ queryKey: ["rep"] });

  const gerar = useMutation({
    mutationFn: async () => {
      if (valorCents <= 0) throw new Error("Digite o valor da cobrança.");
      if (acimaDoSaldo) throw new Error(`O valor passa do saldo da parcela (${brl(c.saldo_cents)}).`);
      await antes?.();
      const inst = valorCents === c.saldo_cents ? c.installment_id : await repCobrancaParcial(c.installment_id, valorCents, chave);
      const r = await cobrar({ data: { installmentId: inst, forma: "UNDEFINED" } });
      return { ...r, valor: valorCents };
    },
    onSuccess: async (r) => {
      setRes(r);
      if (r.url) setQrLink(await QRCode.toDataURL(r.url, { margin: 1, width: 320 }).catch(() => null));
      toast.success(r.reaproveitada ? "Cobrança já existia: reaproveitada, nada duplicado." : "Cobrança criada no Asaas em nome da Lardan.");
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const dinheiro = useMutation({
    mutationFn: async () => {
      if (valorCents <= 0) throw new Error("Digite o valor recebido.");
      if (acimaDoSaldo) throw new Error(`O valor passa do saldo da parcela (${brl(c.saldo_cents)}).`);
      await antes?.();
      return repDinheiroReceber(c.installment_id, valorCents, chave, obs);
    },
    onSuccess: (r) => {
      setRecibo(r);
      toast.success(r.repetido ? "Este recebimento já estava lançado." : `Recibo nº ${r.numero} lançado. A parcela já baixou.`);
      if (r.aviso_asaas) toast.warning("Esta parcela tinha um link de pagamento aberto. Avise a cliente para não pagar o link: a Lardan vai cancelá-lo.", { duration: 10000 });
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cheque = useMutation({
    mutationFn: async () => { await antes?.(); return repCheque({ ...ch, valor_cents: centavos(ch.valor), bom_para: bomPara ? iso(bomPara) : "", recebido_de_party_id: c.party_id,
      observacao: `parcela ${c.numero ?? ""} · ${ch.observacao}`.trim() }); },
    onSuccess: () => { toast.success("Cheque registrado em custódia. A baixa é feita pelo financeiro quando compensar."); setAberto(false); recarregar(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const texto = (u: string, v: number) => `Olá, ${primeiro}! Segue o link para pagamento de ${brl(v)} — LARDAN: ${u}`;
  const copiar = (t: string) => { void navigator.clipboard.writeText(t); toast.success("Copiado."); };
  const campo = (k: keyof typeof ch, rot: string, ph = "", mask = false) => (
    <label className="block text-sm"><span className="mb-1 block text-xs text-muted-foreground">{rot}</span>
      <input value={ch[k]} placeholder={ph} inputMode={mask ? "numeric" : undefined} onChange={(e) => setCh({ ...ch, [k]: mask ? mascaraValor(e.target.value) : e.target.value })} className="h-11 w-full rounded-xl border border-border bg-background px-3 outline-none" /></label>
  );
  const abrir = () => { setRes(null); setRecibo(null); setQrLink(null); setForma("LINK"); setObs(""); setValor(mascaraValor(String(c.saldo_cents))); setChave(crypto.randomUUID()); setAberto(true); };
  const pronto = res || recibo;

  return (
    <>
      <button type="button" onClick={abrir} className="rounded-full bg-asaas px-3 py-1.5 text-xs font-semibold text-asaas-foreground">{rotulo ?? "Cobrar"}</button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cobrar {primeiro}</DialogTitle>
            <DialogDescription>
              Título {c.numero ?? "—"} · vence {dataBR(c.vencimento)} · saldo <strong>{brl(c.saldo_cents)}</strong>. Dá para cobrar até o saldo; valor menor fica ligado a esta parcela.
            </DialogDescription>
          </DialogHeader>
          {!pronto && (
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Forma">
              {FORMAS.map((f) => (
                <button key={f.id} type="button" aria-pressed={forma === f.id} onClick={() => setForma(f.id)}
                  className={`rounded-xl border px-2 py-2 text-left text-xs ${forma === f.id ? (f.id === "LINK" ? "border-asaas bg-asaas text-asaas-foreground" : "border-primary bg-primary text-primary-foreground") : "border-border text-muted-foreground"}`}>
                  <span className="block font-semibold">{f.rotulo}</span><span className="opacity-80">{f.dica}</span>
                </button>
              ))}
            </div>
          )}
          {!pronto && forma !== "CHEQUE" && (
            <div className="space-y-3">
              <label className="block text-sm"><span className="mb-1 block text-xs text-muted-foreground">{forma === "DINHEIRO" ? "Valor recebido (R$)" : "Valor da cobrança (R$)"}</span>
                <input autoFocus inputMode="numeric" value={valor} onChange={(e) => setValor(mascaraValor(e.target.value))} placeholder="0,00"
                  className={`h-14 w-full rounded-xl border bg-background px-4 text-2xl font-semibold tabular-nums outline-none ${acimaDoSaldo ? "border-destructive" : "border-border focus:border-asaas"}`} /></label>
              {acimaDoSaldo && <p className="text-xs text-destructive">Passa do saldo da parcela ({brl(c.saldo_cents)}).</p>}
              {!acimaDoSaldo && valorCents > 0 && valorCents < c.saldo_cents && (
                <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">Fica em aberto {brl(c.saldo_cents - valorCents)} desta parcela.</p>
              )}
              {forma === "DINHEIRO" && (
                <>
                  <label className="block text-sm"><span className="mb-1 block text-xs text-muted-foreground">Observação no recibo (opcional)</span>
                    <input value={obs} onChange={(e) => setObs(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 outline-none" /></label>
                  <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">O valor entra na conta "Retido Representante" até você repassar à Lardan. A parcela baixa na hora.</p>
                  <button type="button" disabled={dinheiro.isPending || valorCents <= 0 || acimaDoSaldo} onClick={() => dinheiro.mutate()} className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                    {dinheiro.isPending ? "Lançando…" : `Lançar ${brl(valorCents)} e gerar recibo`}
                  </button>
                </>
              )}
              {forma === "LINK" && (
                <button type="button" disabled={gerar.isPending || valorCents <= 0 || acimaDoSaldo} onClick={() => gerar.mutate()} className="w-full rounded-xl bg-asaas px-4 py-3 text-sm font-semibold text-asaas-foreground disabled:opacity-50">
                  {gerar.isPending ? "Gerando no Asaas…" : `Gerar link de cobrança de ${brl(valorCents)}`}
                </button>
              )}
            </div>
          )}
          {!pronto && forma === "CHEQUE" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {campo("numero", "Número do cheque")}{campo("banco", "Banco")}{campo("agencia", "Agência")}{campo("conta", "Conta")}
              </div>
              {campo("emitente_nome", "Emitente (nome no cheque)", c.display_name)}
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
          )}
          {recibo && (
            <div className="space-y-3 text-center">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Recibo nº {recibo.numero}</p>
              <p className="text-2xl font-semibold tabular-nums">{brl(recibo.valor_cents)}</p>
              <p className="text-sm text-muted-foreground">Saldo que fica em aberto: {brl(recibo.saldo_restante_cents)}</p>
              {recibo.aviso_asaas && <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs">Esta parcela tinha um link de pagamento aberto. Avise a cliente para não pagar o link: a Lardan vai cancelá-lo.</p>}
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className="admin-btn" onClick={() => imprimirRecibo(recibo)}><Printer className="size-4" /> Imprimir recibo</button>
                <a className="admin-btn" target="_blank" rel="noreferrer" href={wa(whatsapp, textoReciboWhatsApp(recibo))}><MessageCircle className="size-4" /> Enviar no WhatsApp</a>
              </div>
            </div>
          )}
          {res && (
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

const TIPOS: { id: TipoContato; rotulo: string }[] = [
  { id: "ligacao", rotulo: "Liguei" }, { id: "whatsapp_aberto", rotulo: "WhatsApp" }, { id: "negociacao", rotulo: "Negociei" }, { id: "anotacao", rotulo: "Anotação" },
];
const RESULTADOS: { id: ResultadoContato; rotulo: string }[] = [
  { id: "sucesso", rotulo: "Falei com ela" }, { id: "nao_atendeu", rotulo: "Não atendeu" }, { id: "recado", rotulo: "Deixei recado" }, { id: "sem_sucesso", rotulo: "Sem acordo" },
];
const ROTULO_TIPO: Record<string, string> = { ligacao: "Ligação", whatsapp_aberto: "WhatsApp", negociacao: "Negociação", anotacao: "Anotação", desconto_solicitado: "Desconto", negativacao_encaminhada: "Negativação" };

/**
 * Registrar contato e promessa (0160) — grava no MESMO histórico da Central de Cobrança (cob_interacoes / cob_promessas).
 */
export function ContatoCobranca({ c, parcelas, rotulo }: { c: { party_id: string; display_name: string }; parcelas: { installment_id: string; numero: string | null; saldo_cents: number; vencimento: string }[]; rotulo?: string }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = React.useState(false);
  const [tipo, setTipo] = React.useState<TipoContato>("ligacao");
  const [resultado, setResultado] = React.useState<ResultadoContato | null>("sucesso");
  const [obs, setObs] = React.useState("");
  const [promete, setPromete] = React.useState(false);
  const [pVal, setPVal] = React.useState("");
  const [pData, setPData] = React.useState<Date | undefined>();
  const [escolhidas, setEscolhidas] = React.useState<string[]>([]);
  const hist = useQuery({ queryKey: ["rep", "historico", c.party_id], queryFn: () => repCobHistorico(c.party_id), enabled: aberto });
  const saldoEscolhido = parcelas.filter((p) => escolhidas.includes(p.installment_id)).reduce((a, p) => a + p.saldo_cents, 0);
  const abrir = () => { setTipo("ligacao"); setResultado("sucesso"); setObs(""); setPromete(false); setPVal(""); setPData(undefined); setEscolhidas(parcelas.slice(0, 1).map((p) => p.installment_id)); setAberto(true); };
  const salvar = useMutation({
    mutationFn: async () => {
      if (promete) {
        if (!pData) throw new Error("Escolha a data da promessa.");
        if (escolhidas.length === 0) throw new Error("Escolha a parcela da promessa.");
        await repCobPromessa(c.party_id, centavos(pVal), iso(pData), escolhidas, obs);
        if (tipo !== "negociacao") await repCobRegistrar(c.party_id, tipo, resultado, obs || "Promessa registrada", escolhidas);
      } else {
        await repCobRegistrar(c.party_id, tipo, resultado, obs, escolhidas);
      }
    },
    onSuccess: () => { toast.success(promete ? "Promessa registrada. Aparece também na Central de Cobrança." : "Contato registrado."); setAberto(false); void qc.invalidateQueries({ queryKey: ["rep"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const chip = (ativo: boolean) => `rounded-full border px-3 py-1.5 text-xs ${ativo ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground"}`;
  return (
    <>
      <button type="button" onClick={abrir} className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold"><PhoneCall className="size-3.5" /> {rotulo ?? "Contato"}</button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
          <DialogHeader><DialogTitle>Contato com {c.display_name.split(" ")[0]}</DialogTitle>
            <DialogDescription>Fica no histórico da consultora, o mesmo que a Central de Cobrança da Lardan vê.</DialogDescription></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">{TIPOS.map((t) => <button key={t.id} type="button" className={chip(tipo === t.id)} onClick={() => setTipo(t.id)}>{t.rotulo}</button>)}</div>
            <div className="flex flex-wrap gap-2">{RESULTADOS.map((r) => <button key={r.id} type="button" className={chip(resultado === r.id)} onClick={() => setResultado(r.id)}>{r.rotulo}</button>)}</div>
            <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="O que ficou combinado" className="w-full rounded-xl border border-border bg-background px-3 py-2 outline-none" />
            {parcelas.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Parcelas</p>
                {parcelas.map((p) => (
                  <label key={p.installment_id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                    <span className="flex items-center gap-2"><input type="checkbox" checked={escolhidas.includes(p.installment_id)}
                      onChange={(e) => setEscolhidas(e.target.checked ? [...escolhidas, p.installment_id] : escolhidas.filter((x) => x !== p.installment_id))} />
                      Título {p.numero ?? "—"} · vence {dataBR(p.vencimento)}</span>
                    <span className="tabular-nums">{brl(p.saldo_cents)}</span>
                  </label>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2"><input type="checkbox" checked={promete} onChange={(e) => { setPromete(e.target.checked); if (e.target.checked && !pVal) setPVal(mascaraValor(String(saldoEscolhido))); }} /> Ela prometeu pagar</label>
            {promete && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Valor (até {brl(saldoEscolhido)})</span>
                  <input inputMode="numeric" value={pVal} onChange={(e) => setPVal(mascaraValor(e.target.value))} className="h-11 w-full rounded-xl border border-border bg-background px-3 outline-none" /></label>
                <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Quando</span><DateField value={pData} onChange={setPData} /></label>
              </div>
            )}
            <button type="button" disabled={salvar.isPending} onClick={() => salvar.mutate()} className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {salvar.isPending ? "Salvando…" : promete ? "Salvar contato e promessa" : "Salvar contato"}
            </button>
            <section className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Histórico</p>
              {hist.data?.promessas.filter((p) => p.status === "vigente").map((p, i) => (
                <p key={i} className="rounded-lg bg-primary/10 px-3 py-2 text-xs">Promessa vigente: {brl(p.valor_cents)} para {dataBR(p.data)}</p>
              ))}
              {(hist.data?.interacoes ?? []).length === 0 && <p className="text-xs text-muted-foreground">{hist.isLoading ? "Carregando…" : "Nenhum contato registrado ainda."}</p>}
              <ul className="space-y-2">
                {hist.data?.interacoes.slice(0, 12).map((h, i) => (
                  <li key={i} className="rounded-lg border border-border px-3 py-2 text-xs">
                    <p className="font-medium">{ROTULO_TIPO[h.tipo] ?? h.tipo} · {new Date(h.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {h.autor}</p>
                    {h.obs && <p className="text-muted-foreground">{h.obs}</p>}
                  </li>
                ))}
              </ul>
            </section>
          </div>
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
  const livres = d.etapas.filter((e) => !e.sistema);
  const link = d.codigo ? `https://www.lardan.com.br/seja-lardan?rep=${d.codigo}` : null;
  const STATUS: Record<string, string> = { novo: "Aguardando Lardan", em_analise: "Em análise na Lardan", qualificado: "Qualificada", aprovado: "Aprovada pela Lardan", recusado: "Não aprovada" };
  const ORIGEM: Record<string, string> = { link: "pelo seu link", manual: "cadastrada por você", encaminhada: "enviada pela Lardan", madrinha: "indicada por uma consultora sua" };

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
                  <span className="flex items-center gap-1.5 text-sm font-semibold">{e.sistema && <Lock aria-hidden className="size-3.5" />}{e.nome}</span><span className="text-xs text-muted-foreground">{cards.length}</span>
                </div>
                {e.sistema && <p className="px-4 pt-2 text-[0.7rem] text-muted-foreground">Muda sozinha pela Lardan.</p>}
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
                        {c.travado ? (
                          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3.5" /> segue a Lardan</span>
                        ) : (() => {
                          const j = livres.findIndex((x) => x.id === e.id);
                          return (
                            <>
                              {j > 0 && <button type="button" onClick={() => mover.mutate({ lead: c.lead_id, etapa: livres[j - 1]!.id })} className="grid size-9 place-items-center rounded-full border border-border" aria-label="Voltar etapa"><ChevronLeft className="size-4" /></button>}
                              {j >= 0 && j < livres.length - 1 && <button type="button" onClick={() => mover.mutate({ lead: c.lead_id, etapa: livres[j + 1]!.id })} className="ml-auto flex h-9 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">Avançar <ChevronRight className="size-4" /></button>}
                            </>
                          );
                        })()}
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
