import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Gavel, FileText, Upload, Scale, Landmark } from "lucide-react";
import { DateField } from "@/components/premium/DateField";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { brl, dataBR, hojeSP, judicial, judicialDocs, acordosJudiciais, encaminharJudicial, salvarAcordoJudicial, statusAcordoJudicial, TIPOS_DOC_JUDICIAL, type Parcela } from "@/lib/cobranca";
import { enviarDocJudicial, abrirDocJudicial, excluirDocJudicial } from "@/lib/cobranca.functions";
import { montarPlano, addMeses } from "@/lib/cobranca-acordo";
import { AcordoAsaas } from "./AcordoAsaas";
import { AlvaraJudicial } from "./AlvaraJudicial";

const iso = (d?: Date) => (d ? d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : "");
const paraData = (s: string) => (s ? new Date(s + "T12:00:00") : undefined);
const reais = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".") || 0) * 100);
const txt = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const inp = "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm";
const ROT_ST: Record<string, string> = { vigente: "Vigente", cumprido: "Cumprido", descumprido: "Descumprido", cancelado: "Cancelado" };

/** Formulário de dados do processo — usado no botão "Encaminhar para judicial" e na edição. */
export function FormProcesso({ partyId, inicial, onFim }: { partyId: string; inicial?: Partial<Record<"processo" | "vara" | "comarca" | "advogado" | "data_ajuizamento" | "observacao", string | null>> | null; onFim: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = React.useState({
    processo: inicial?.processo ?? "", vara: inicial?.vara ?? "", comarca: inicial?.comarca ?? "", advogado: inicial?.advogado ?? "",
    data_ajuizamento: inicial?.data_ajuizamento ?? "", observacao: inicial?.observacao ?? "",
  });
  const [salv, setSalv] = React.useState(false);
  const campo = (k: keyof typeof f, r: string, ph = "") => (
    <label className="text-xs font-medium text-ledger-muted">{r}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} className={`${inp} mt-1`} /></label>
  );
  const salvar = async () => {
    setSalv(true);
    try { await encaminharJudicial(partyId, f); toast.success(inicial ? "Processo atualizado." : "Encaminhada para judicial."); qc.invalidateQueries({ queryKey: ["cob"] }); onFim(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não salvou."); } finally { setSalv(false); }
  };
  return (
    <section className="space-y-4 rounded-2xl border-2 border-bronze/50 bg-surface p-6">
      <h3 className="flex items-center gap-2 font-display text-xl text-ledger-text"><Gavel className="size-5 text-bronze" />{inicial ? "Dados do processo" : "Encaminhar para judicial"}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {campo("processo", "Número do processo", "0000000-00.0000.0.00.0000")}
        {campo("advogado", "Advogado(a) responsável")}
        {campo("vara", "Vara")}
        {campo("comarca", "Comarca")}
        <label className="text-xs font-medium text-ledger-muted">Data do ajuizamento<div className="mt-1"><DateField value={paraData(f.data_ajuizamento ?? "")} onChange={(d) => setF({ ...f, data_ajuizamento: iso(d) })} /></div></label>
      </div>
      <textarea value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} rows={2} placeholder="Observação" className="w-full rounded-lg border border-line bg-surface p-3 text-sm" />
      <div className="flex gap-2">
        <button disabled={salv} onClick={salvar} className="h-10 rounded-lg bg-bronze px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{inicial ? "Salvar processo" : "Confirmar encaminhamento"}</button>
        <button onClick={onFim} className="h-10 px-4 text-sm text-ledger-muted">Cancelar</button>
      </div>
    </section>
  );
}

export function AbaJudicial({ partyId, parcelas }: { partyId: string; parcelas: Parcela[] }) {
  const qc = useQueryClient();
  const proc = useQuery({ queryKey: ["cob", "jud", partyId], queryFn: () => judicial(partyId) });
  const docs = useQuery({ queryKey: ["cob", "jud-docs", partyId], queryFn: () => judicialDocs(partyId) });
  const acs = useQuery({ queryKey: ["cob", "jud-ac", partyId], queryFn: () => acordosJudiciais(partyId) });
  const [editProc, setEditProc] = React.useState(false);
  const enviar = useServerFn(enviarDocJudicial);
  const abrir = useServerFn(abrirDocJudicial);
  const [docTipo, setDocTipo] = React.useState("termo_assinado");
  const [docTitulo, setDocTitulo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const arq = React.useRef<HTMLInputElement>(null);

  // acordo
  const [sel, setSel] = React.useState<string[]>(() => parcelas.map((p) => p.installment_id));
  const [dataAc, setDataAc] = React.useState(hojeSP());
  const [hon, setHon] = React.useState(""); const [cart, setCart] = React.useState(""); const [cust, setCust] = React.useState("");
  const [out, setOut] = React.useState(""); const [outDesc, setOutDesc] = React.useState(""); const [desc, setDesc] = React.useState("");
  const [totalManual, setTotalManual] = React.useState("");
  const [n, setN] = React.useState(1); const [primeira, setPrimeira] = React.useState(addMeses(hojeSP(), 1));
  const [manual, setManual] = React.useState<{ data: string; valor: string; asaas: boolean }[] | null>(null);
  const [obs, setObs] = React.useState(""); const [salv, setSalv] = React.useState(false);

  // Já está na etapa Judicial: abre a área direto (registro do processo criado vazio, dados preenchidos depois).
  const abrindo = React.useRef(false);
  const [falhaAbrir, setFalhaAbrir] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (proc.isLoading || proc.data || abrindo.current) return;
    abrindo.current = true;
    encaminharJudicial(partyId, {}).then(() => qc.invalidateQueries({ queryKey: ["cob"] }))
      .catch((e) => setFalhaAbrir(e instanceof Error ? e.message : "Não abriu a área judicial."));
  }, [proc.isLoading, proc.data, partyId, qc]);

  if (proc.isLoading) return <p className="text-sm text-ledger-muted">Carregando…</p>;
  if (!proc.data || editProc) {
    if (!proc.data) return falhaAbrir
      ? <p className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-ledger-text">{falhaAbrir}</p>
      : <p className="text-sm text-ledger-muted">Abrindo área judicial…</p>;
    return <FormProcesso partyId={partyId} inicial={proc.data} onFim={() => setEditProc(false)} />;
  }
  const p = proc.data;

  const principal = parcelas.filter((x) => sel.includes(x.installment_id)).reduce((a, x) => a + Number(x.saldo_cents), 0);
  const custos = reais(hon) + reais(cart) + reais(cust) + reais(out);
  const calculado = Math.max(0, principal + custos - reais(desc));
  const total = totalManual ? reais(totalManual) : calculado;
  const auto = total > 0 ? montarPlano(total, 0, n, primeira).map((x) => ({ data: x.data, valor: txt(x.valor_cents), asaas: true })) : [];
  const plano = manual ?? auto;
  const dif = total - plano.reduce((a, x) => a + reais(x.valor), 0);
  const noAsaas = plano.filter((x) => x.asaas); const totAsaas = noAsaas.reduce((a, x) => a + reais(x.valor), 0);
  const reset = <T,>(f: (v: T) => void) => (v: T) => { f(v); setManual(null); };

  const subir = async (file: File) => {
    setEnviando(true);
    try {
      const b64 = await new Promise<string>((ok, err) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = err; r.readAsDataURL(file); });
      await enviar({ data: { partyId, tipo: docTipo, titulo: docTitulo || file.name, arquivoNome: file.name, arquivoTipo: file.type, arquivoBase64: b64 } });
      toast.success("Documento anexado."); setDocTitulo(""); qc.invalidateQueries({ queryKey: ["cob"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não enviou."); } finally { setEnviando(false); if (arq.current) arq.current.value = ""; }
  };
  const ver = async (id: string) => { try { const r = await abrir({ data: { id } }); window.open(r.url, "_blank", "noopener"); } catch (e) { toast.error(e instanceof Error ? e.message : "Falhou."); } };
  const salvar = async () => {
    if (dif !== 0) { toast.error(`As parcelas precisam fechar o total. Diferença: ${brl(dif)}.`); return; }
    setSalv(true);
    try {
      await salvarAcordoJudicial(partyId, { data_acordo: dataAc, installment_ids: sel, honorarios_cents: reais(hon), cartorio_cents: reais(cart), custas_cents: reais(cust), outros_cents: reais(out), outros_descricao: outDesc, desconto_cents: reais(desc), total_cents: total, plano: plano.map((x, i) => ({ numero: i + 1, data: x.data, valor_cents: reais(x.valor), asaas: x.asaas, alvara: !x.asaas })), observacao: obs });
      toast.success(noAsaas.length ? `Acordo salvo. ${noAsaas.length} parcela(s) prontas para cobrar no Asaas — use o botão azul abaixo ou o Envio em lote.` : "Acordo salvo. Nenhuma parcela vai para o Asaas (alvará/judicial).");
      setManual(null); setHon(""); setCart(""); setCust(""); setOut(""); setOutDesc(""); setDesc(""); setTotalManual(""); setObs("");
      qc.invalidateQueries({ queryKey: ["cob"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não salvou."); } finally { setSalv(false); }
  };
  const mudar = async (id: string, st: "cumprido" | "descumprido" | "cancelado") => {
    const m = prompt("Motivo / observação"); if (!m) return;
    try { await statusAcordoJudicial(id, st, m); qc.invalidateQueries({ queryKey: ["cob"] }); toast.success("Atualizado."); } catch (e) { toast.error(e instanceof Error ? e.message : "Falhou."); }
  };
  const Linha = ({ r, v, set, testid }: { r: string; v: string; set: (s: string) => void; testid?: string }) => (
    <div className="flex items-center justify-between gap-3"><dt className="text-sm">{r}</dt><dd><input data-testid={testid} value={v} onChange={(e) => reset(set)(e.target.value)} placeholder="0,00" className="h-10 w-36 rounded-lg border border-line bg-surface px-3 text-right font-mono text-sm" /></dd></div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 rounded-xl border border-bronze/50 bg-bronze/10 px-5 py-3 text-sm font-medium text-ledger-text">
        <Landmark className="size-4 text-bronze" /> Área judicial: em cada parcela do acordo, marque “Cobrar no Asaas” ou deixe desmarcada para alvará / depósito judicial (sem cobrança).
      </div>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 font-display text-xl text-ledger-text"><Gavel className="size-5 text-bronze" />Processo</h3>
          <button onClick={() => setEditProc(true)} className="h-9 rounded-lg border border-line px-4 text-sm">Editar dados</button>
        </div>
        <dl className="mt-4 grid gap-4 text-sm md:grid-cols-3">
          {([["Número do processo", p.processo], ["Advogado(a)", p.advogado], ["Vara", p.vara], ["Comarca", p.comarca], ["Ajuizamento", p.data_ajuizamento ? dataBR(p.data_ajuizamento) : null], ["Encaminhada em", dataBR(p.encaminhado_em)]] as const).map(([r, v]) => (
            <div key={r}><dt className="text-xs text-ledger-muted">{r}</dt><dd className="mt-0.5 font-medium text-ledger-text">{v || "Não informado"}</dd></div>
          ))}
        </dl>
        {p.observacao && <p className="mt-4 text-sm text-ledger-muted">{p.observacao}</p>}
      </section>

      <section className="space-y-4 rounded-2xl border border-line bg-surface p-6">
        <h3 className="flex items-center gap-2 font-display text-xl text-ledger-text"><FileText className="size-5 text-bronze" />Documentos</h3>
        <p className="text-sm text-ledger-muted">Termos assinados, petições, certidões e tudo que comprova a judicialização. Arquivos privados, só a equipe de cobrança abre.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="w-60 text-xs font-medium text-ledger-muted">Tipo<div className="mt-1"><SmartSelect value={docTipo} onChange={setDocTipo} options={TIPOS_DOC_JUDICIAL.map(([value, label]) => ({ value, label }))} /></div></label>
          <label className="min-w-60 flex-1 text-xs font-medium text-ledger-muted">Título (opcional)<input value={docTitulo} onChange={(e) => setDocTitulo(e.target.value)} placeholder="Ex.: Acordo assinado em audiência" className={`${inp} mt-1`} /></label>
          <input ref={arq} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); }} />
          <button disabled={enviando} onClick={() => arq.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-bronze px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Upload className="size-4" />{enviando ? "Enviando…" : "Anexar PDF ou foto"}</button>
        </div>
        {(docs.data ?? []).length === 0 ? <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ledger-muted">Sem documentos anexados.</p> : (
          <ul className="divide-y divide-line-soft rounded-xl border border-line">
            {(docs.data ?? []).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span><b className="text-ledger-text">{d.titulo}</b> <span className="text-xs text-ledger-muted">· {TIPOS_DOC_JUDICIAL.find((t) => t[0] === d.tipo)?.[1]} · {dataBR(d.created_at)}</span></span>
                <button onClick={() => ver(d.id)} className="h-9 rounded-lg border border-line px-4 text-xs font-semibold">Abrir</button>
              </li>))}
          </ul>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-6">
          <h3 className="font-semibold text-ledger-text">Parcelas incluídas na dívida</h3>
          {parcelas.length === 0 ? <p className="text-sm text-ledger-muted">Sem parcelas em aberto.</p> : (
            <ul className="max-h-80 space-y-1 overflow-auto text-sm">{parcelas.map((x) => (
              <li key={x.installment_id}><label className="flex items-center gap-2 py-1">
                <input type="checkbox" checked={sel.includes(x.installment_id)} onChange={(e) => reset(setSel)(e.target.checked ? [...sel, x.installment_id] : sel.filter((y) => y !== x.installment_id))} />
                <span className="flex-1">{x.numero ?? "Título"} · venc. {dataBR(x.vencimento)}</span><span className="font-mono">{brl(Number(x.saldo_cents))}</span>
              </label></li>))}</ul>
          )}
        </section>
        <section className="space-y-4 rounded-2xl border-2 border-bronze/50 bg-surface p-6">
          <h3 className="flex items-center gap-2 font-display text-xl text-ledger-text"><Scale className="size-5 text-bronze" />Acordo judicial</h3>
          <label className="block w-56 text-xs font-medium text-ledger-muted">Data do acordo<div className="mt-1"><DateField value={paraData(dataAc)} onChange={(d) => d && setDataAc(iso(d))} /></div></label>
          <dl className="space-y-2">
            <div className="flex justify-between text-sm"><dt>Dívida original</dt><dd className="font-mono">{brl(principal)}</dd></div>
            <Linha r="Honorários do advogado" v={hon} set={setHon} testid="jud-honorarios" />
            <Linha r="Cartório / protesto" v={cart} set={setCart} />
            <Linha r="Custas processuais" v={cust} set={setCust} />
            <div className="flex items-center justify-between gap-3"><dt><input value={outDesc} onChange={(e) => setOutDesc(e.target.value)} placeholder="Outros (descreva)" className="h-10 w-48 rounded-lg border border-line bg-surface px-3 text-sm" /></dt><dd><input value={out} onChange={(e) => reset(setOut)(e.target.value)} placeholder="0,00" className="h-10 w-36 rounded-lg border border-line bg-surface px-3 text-right font-mono text-sm" /></dd></div>
            <Linha r="Desconto" v={desc} set={setDesc} />
            <div className="flex justify-between border-t border-line pt-2 text-sm text-ledger-muted"><dt>Calculado</dt><dd className="font-mono">{brl(calculado)}</dd></div>
            <div className="flex items-center justify-between gap-3 text-base font-semibold"><dt>Valor total do acordo</dt><dd><input data-testid="jud-total" value={totalManual} onChange={(e) => reset(setTotalManual)(e.target.value)} placeholder={txt(calculado)} className="h-11 w-40 rounded-lg border-2 border-bronze/60 bg-surface px-3 text-right font-mono text-base" /></dd></div>
          </dl>
          <p className="text-xs text-ledger-muted">Deixe o total em branco para usar o calculado, ou digite o valor homologado.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-ledger-muted">Parcelas<input type="number" min={1} max={120} value={n} onChange={(e) => reset(setN)(Math.max(1, Math.min(120, Number(e.target.value) || 1)))} className="mt-1 block h-10 w-20 rounded-lg border border-line bg-surface px-3 text-sm" /></label>
            <label className="text-xs font-medium text-ledger-muted">1ª parcela<div className="mt-1"><DateField value={paraData(primeira)} onChange={(d) => d && reset(setPrimeira)(iso(d))} /></div></label>
          </div>
          {plano.length > 0 && (
            <div className="space-y-2 rounded-lg border border-line-soft p-3">
              <div className="flex justify-between text-xs text-ledger-muted"><span>Datas, valores e onde cada parcela é paga</span>{manual && <button className="underline" onClick={() => setManual(null)}>Dividir igual de novo</button>}</div>
              <ul className="max-h-72 space-y-2 overflow-auto">{plano.map((x, i) => (
                <li key={i} className="flex items-center gap-2 text-sm"><span className="w-8 text-xs text-ledger-muted">{i + 1}ª</span>
                  <div className="flex-1"><DateField value={paraData(x.data)} onChange={(d) => d && setManual(plano.map((y, k) => (k === i ? { ...y, data: iso(d) } : y)))} /></div>
                  <input value={x.valor} onChange={(e) => setManual(plano.map((y, k) => (k === i ? { ...y, valor: e.target.value } : y)))} className="h-10 w-28 rounded-lg border border-line bg-surface px-3 text-right font-mono text-sm" />
                  <label data-testid={`jud-asaas-${i + 1}`} className={`flex h-10 w-40 cursor-pointer items-center gap-2 rounded-lg border px-2 text-xs font-semibold ${x.asaas ? "border-asaas/60 bg-asaas/10 text-asaas" : "border-bronze/50 bg-bronze/10 text-bronze"}`}>
                    <input type="checkbox" checked={x.asaas} onChange={(e) => setManual(plano.map((y, k) => (k === i ? { ...y, asaas: e.target.checked } : y)))} />
                    {x.asaas ? "Cobrar no Asaas" : "Alvará / judicial"}
                  </label>
                </li>))}</ul>
              <p className="text-xs text-ledger-muted"><b className="text-asaas">{noAsaas.length} parcela(s) · {brl(totAsaas)}</b> vão para o Asaas · <b className="text-bronze">{plano.length - noAsaas.length} · {brl(total - totAsaas)}</b> por alvará / judicial (sem cobrança).</p>
              <p className={`text-xs ${dif === 0 ? "text-success" : "text-danger"}`}>{dif === 0 ? "Parcelas fecham o total." : `Falta ${dif > 0 ? "distribuir" : "tirar"} ${brl(Math.abs(dif))}.`}</p>
            </div>
          )}
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Observação (ex.: homologado na audiência)" className="w-full rounded-lg border border-line bg-surface p-2 text-sm" />
          <button disabled={salv || dif !== 0 || total <= 0} onClick={salvar} className="h-11 w-full rounded-lg bg-bronze text-sm font-semibold text-primary-foreground disabled:opacity-50">Salvar acordo judicial</button>
        </section>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ledger-text">Acordos judiciais lançados</h3>
        {(acs.data ?? []).length === 0 ? <p className="text-sm text-ledger-muted">Nenhum acordo judicial.</p> : (acs.data ?? []).map((a) => (
          <div key={a.id} className={`space-y-1 rounded-xl border border-line bg-surface p-4 text-sm ${a.status === "cancelado" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Acordo de <b>{dataBR(a.data_acordo)}</b> · total <b className="font-mono">{brl(Number(a.total_cents))}</b> · {a.plano.length}x · <b>{ROT_ST[a.status]}</b>{a.status_motivo && ` (${a.status_motivo})`}</span>
              {a.status === "vigente" && <span className="flex gap-3 text-xs"><button className="underline" onClick={() => mudar(a.id, "cumprido")}>Cumprido</button><button className="underline" onClick={() => mudar(a.id, "descumprido")}>Descumprido</button><button className="text-danger underline" onClick={() => mudar(a.id, "cancelado")}>Cancelar</button></span>}
            </div>
            <p className="text-xs text-ledger-muted">Dívida {brl(Number(a.principal_cents))} · honorários {brl(Number(a.honorarios_cents))} · cartório {brl(Number(a.cartorio_cents))} · custas {brl(Number(a.custas_cents))}{Number(a.outros_cents) > 0 && ` · ${a.outros_descricao ?? "outros"} ${brl(Number(a.outros_cents))}`}{Number(a.desconto_cents) > 0 && ` · desconto ${brl(Number(a.desconto_cents))}`}</p>
            <p className="text-xs text-ledger-muted">{a.plano.map((x) => `${x.numero}ª ${dataBR(x.data)} ${brl(x.valor_cents)}${x.asaas ? " (Asaas)" : " (alvará/judicial)"}`).join(" · ")}</p>
            {a.simulacao_id && a.status === "vigente" && <AcordoAsaas simId={a.simulacao_id} temEntrada={false} />}
            <AlvaraJudicial acordo={a} />
            {!a.simulacao_id && <p className="text-xs text-bronze">Sem parcelas no Asaas: aguarda alvará / pagamento em juízo.</p>}
          </div>
        ))}
      </section>
    </div>
  );
}
