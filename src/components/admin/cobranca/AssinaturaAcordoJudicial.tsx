import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileSignature, Copy, ExternalLink, RefreshCw, Upload, CheckCircle2, Clock } from "lucide-react";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { dataBR, type AcordoJudicial, type AssinaturaJudicial, type JudicialDoc } from "@/lib/cobranca";
import { enviarDocJudicial } from "@/lib/cobranca.functions";
import { zapsignAcordoJudicial, zapsignAcordoJudicialVerificar, zapsignAcordoJudicialArquivo } from "@/lib/zapsign/judicial.functions";

const inp = "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm";
const ST: Record<string, string> = { pendente: "Aguardando assinatura", assinado: "Assinado", recusado: "Recusado pela devedora", cancelado: "Cancelado", erro: "Erro no envio" };

/**
 * 0318 — Acordo judicial para assinatura (ZapSign): envia o PDF da minuta anexada, exatamente como o
 * advogado escreveu. A devedora valida com código no WhatsApp, selfie e documento; o advogado é opcional.
 */
export function AssinaturaAcordoJudicial({ partyId, acordo, docs, assinaturas, advogadoPadrao, contato }: {
  partyId: string; acordo: AcordoJudicial; docs: JudicialDoc[]; assinaturas: AssinaturaJudicial[]; advogadoPadrao: string | null;
  contato: { whatsapp: string | null; email: string | null };
}) {
  const qc = useQueryClient();
  const enviar = useServerFn(zapsignAcordoJudicial);
  const verificar = useServerFn(zapsignAcordoJudicialVerificar);
  const arquivo = useServerFn(zapsignAcordoJudicialArquivo);
  const anexar = useServerFn(enviarDocJudicial);
  const pdfs = docs.filter((d) => d.content_type === "application/pdf");
  const padrao = pdfs.find((d) => d.tipo === "minuta_acordo") ?? pdfs[0];
  const [docId, setDocId] = React.useState<string>(padrao?.id ?? "");
  React.useEffect(() => { if (!docId && padrao) setDocId(padrao.id); }, [docId, padrao]);
  const [comAdv, setComAdv] = React.useState(false);
  const [advNome, setAdvNome] = React.useState(advogadoPadrao ?? "");
  const [advEmail, setAdvEmail] = React.useState("");
  const [ocupado, setOcupado] = React.useState(false);
  const [subindo, setSubindo] = React.useState(false);
  const arq = React.useRef<HTMLInputElement>(null);

  const minhas = assinaturas.filter((a) => a.acordo_id === acordo.id);
  const atual = minhas.find((a) => a.status === "pendente") ?? minhas.find((a) => a.status === "assinado");
  const atualizar = () => qc.invalidateQueries({ queryKey: ["cob"] });

  const mandar = async (reenviar: boolean) => {
    if (!docId) { toast.error("Anexe ou escolha o PDF do acordo."); return; }
    const alvo = [contato.whatsapp && `WhatsApp ${contato.whatsapp}`, contato.email && `e-mail ${contato.email}`].filter(Boolean).join(" e ");
    if (!confirm(`${reenviar ? "Cancelar o link pendente e enviar um novo" : "Enviar o acordo para assinatura"}?\n\nVai para ${alvo || "o contato do cadastro"}${comAdv ? ` e para o advogado (${advEmail})` : ""}.`)) return;
    setOcupado(true);
    try {
      const r = await enviar({ data: { acordoId: acordo.id, docId, reenviar, advogado: comAdv ? { nome: advNome, email: advEmail } : null } });
      if (r.jaExistia) toast.info("Já existe um link aguardando assinatura para este acordo.");
      else toast.success(r.whatsapp ? "Acordo enviado pelo WhatsApp da devedora (e por e-mail, se cadastrado)." : "Acordo enviado por e-mail. Copie o link se quiser mandar também pelo WhatsApp.");
      atualizar();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível enviar."); } finally { setOcupado(false); }
  };
  const conferir = async (id: string) => {
    setOcupado(true);
    try { const r = await verificar({ data: { id } }); toast.success(r.status === "assinado" ? "Assinado! A cópia ficou guardada." : `Situação na ZapSign: ${ST[r.status ?? ""] ?? r.status ?? "sem retorno"}.`); atualizar(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não conferiu."); } finally { setOcupado(false); }
  };
  const abrir = async (id: string) => {
    try { const r = await arquivo({ data: { id } }); if (r.url) window.open(r.url, "_blank", "noopener"); else toast.error("Arquivo indisponível."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não abriu."); }
  };
  const subir = async (file: File) => {
    if (file.type !== "application/pdf") { toast.error("Envie a minuta em PDF."); return; }
    setSubindo(true);
    try {
      const b64 = await new Promise<string>((ok, err) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = err; r.readAsDataURL(file); });
      const r = await anexar({ data: { partyId, tipo: "minuta_acordo", titulo: `Minuta do acordo — ${file.name}`, arquivoNome: file.name, arquivoTipo: file.type, arquivoBase64: b64 } });
      setDocId(r.id); toast.success("Minuta anexada."); atualizar();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não anexou."); } finally { setSubindo(false); if (arq.current) arq.current.value = ""; }
  };
  const copiar = (t: string, msg: string) => { void navigator.clipboard.writeText(t); toast.success(msg); };

  return (
    <div data-testid={`jud-assinatura-${acordo.id}`} className="mt-2 space-y-3 rounded-lg border border-bronze/50 bg-bronze/5 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-ledger-text"><FileSignature className="size-4 text-bronze" />Assinatura do acordo (ZapSign)</p>

      {atual ? (
        <div className="space-y-2 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            {atual.status === "assinado" ? <CheckCircle2 className="size-4 text-success" /> : <Clock className="size-4 text-bronze" />}
            <b className={atual.status === "assinado" ? "text-success" : "text-ledger-text"}>{ST[atual.status]}</b>
            <span className="text-xs text-ledger-muted">· enviado em {dataBR(atual.criado_em)}{atual.assinado_em && ` · assinado em ${dataBR(atual.assinado_em)}`}{atual.doc_titulo && ` · ${atual.doc_titulo}`}{atual.ambiente === "sandbox" && " · ambiente de teste"}</span>
          </p>
          {(atual.assinantes ?? []).length > 0 && <p className="text-xs text-ledger-muted">Assinantes: {(atual.assinantes ?? []).map((s) => `${s.nome} (${s.papel === "advogado" ? "advogado, por e-mail" : [s.whatsapp && "WhatsApp", s.email && "e-mail"].filter(Boolean).join(" + ") || "link"})`).join(" · ")}</p>}
          <div className="flex flex-wrap gap-2">
            {atual.sign_url && <button onClick={() => copiar(atual.sign_url!, "Link da devedora copiado.")} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-surface px-3 text-xs font-semibold"><Copy className="size-3.5" />Copiar link da devedora</button>}
            {(atual.assinantes ?? []).filter((s) => s.papel === "advogado" && s.sign_url && atual.status === "pendente").map((s) => (
              <button key={s.nome} onClick={() => copiar(s.sign_url!, "Link do advogado copiado.")} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-surface px-3 text-xs font-semibold"><Copy className="size-3.5" />Copiar link do advogado</button>))}
            <button onClick={() => void abrir(atual.id)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-surface px-3 text-xs font-semibold"><ExternalLink className="size-3.5" />{atual.status === "assinado" ? "Abrir acordo assinado" : "Ver documento enviado"}</button>
            {atual.status === "pendente" && <>
              <button disabled={ocupado} onClick={() => void conferir(atual.id)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-surface px-3 text-xs font-semibold disabled:opacity-50"><RefreshCw className="size-3.5" />Verificar se já assinou</button>
              <button disabled={ocupado} onClick={() => void mandar(true)} className="h-9 rounded-lg px-3 text-xs text-ledger-muted underline disabled:opacity-50">Cancelar e reenviar</button>
            </>}
          </div>
        </div>
      ) : acordo.status !== "vigente" ? (
        <p className="text-xs text-ledger-muted">Acordo encerrado: não envia para assinatura.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-ledger-muted">Envia o PDF do acordo do jeito que o advogado escreveu. A devedora recebe o link {contato.whatsapp ? <>no WhatsApp <b>{contato.whatsapp}</b></> : "por e-mail"}{contato.email && contato.whatsapp ? <> e no e-mail <b>{contato.email}</b></> : contato.email ? <> <b>{contato.email}</b></> : null} e confirma com código, selfie e foto do documento.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-72 flex-1 text-xs font-medium text-ledger-muted">PDF do acordo
              <div className="mt-1">{pdfs.length ? <SmartSelect value={docId} onChange={setDocId} options={pdfs.map((d) => ({ value: d.id, label: `${d.titulo} · ${dataBR(d.created_at)}` }))} /> : <p className="flex h-10 items-center rounded-lg border border-dashed border-line px-3 text-sm">Nenhum PDF anexado ainda.</p>}</div>
            </label>
            <input ref={arq} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); }} />
            <button disabled={subindo} onClick={() => arq.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-bronze/60 bg-surface px-4 text-sm font-semibold text-ledger-text disabled:opacity-50"><Upload className="size-4" />{subindo ? "Anexando…" : "Anexar minuta (PDF)"}</button>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-ledger-text"><input type="checkbox" checked={comAdv} onChange={(e) => setComAdv(e.target.checked)} />Incluir o advogado como assinante (por e-mail)</label>
          {comAdv && <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-ledger-muted">Nome do advogado<input value={advNome} onChange={(e) => setAdvNome(e.target.value)} className={`${inp} mt-1`} /></label>
            <label className="text-xs font-medium text-ledger-muted">E-mail do advogado<input type="email" value={advEmail} onChange={(e) => setAdvEmail(e.target.value)} className={`${inp} mt-1`} /></label>
          </div>}
          <button data-testid={`jud-zapsign-enviar-${acordo.id}`} disabled={ocupado || !docId} onClick={() => void mandar(false)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-bronze px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"><FileSignature className="size-4" />{ocupado ? "Enviando…" : "Enviar para assinatura (ZapSign)"}</button>
        </div>
      )}
      {minhas.filter((a) => a !== atual).length > 0 && <p className="text-xs text-ledger-muted">Envios anteriores: {minhas.filter((a) => a !== atual).map((a) => `${dataBR(a.criado_em)} ${ST[a.status]}${a.invalidada_motivo ? ` (${a.invalidada_motivo})` : ""}`).join(" · ")}</p>}
    </div>
  );
}
