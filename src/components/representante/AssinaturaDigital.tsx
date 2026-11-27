/**
 * Assinatura digital (ZapSign) na tela da consultora: contrato e promissória
 * de cada maleta. O link vai sozinho pelo WhatsApp dela; o representante
 * também pode copiar o link e mandar. Situação atualiza pelo aviso da ZapSign
 * e (0266) também consultando a ZapSign na hora: ao abrir a tela com documento
 * pendente e pelo botão "Verificar se já assinou".
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, CircleCheckBig, Copy, FileSignature, Loader2, MessageSquareText, PenLine, Printer, RefreshCw, SearchCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { zapsignArquivo, zapsignEnviar, zapsignVerificar } from "@/lib/zapsign/zapsign.functions";
import { promissoriaPapelComFoto } from "@/lib/promissoria-papel.functions";
import { promissoriaDadosImpressao, promissoriaPapelCancelar } from "@/lib/rep-assinaturas";
import { fotoReduzida, htmlPromissoria, imprimirA4 } from "@/lib/promissoria-html";

export interface DocAssinatura {
  id: string; tipo: "contrato" | "promissoria"; titulo: string; status: "pendente" | "assinado" | "recusado" | "cancelado" | "erro";
  ambiente: string; sign_url: string | null; cycle_id: string | null; maleta: string | null; valor_cents: number | null;
  criado_em: string; assinado_em: string | null; enviado_whatsapp: boolean;
  /** 0279: promissória substituída porque a maleta foi transferida para outra consultora */
  invalidada_em?: string | null; invalidada_motivo?: string | null;
}
interface Maleta { cycle_id: string; maleta: string; status: string; remessa: number | null; valor_cents: number }
/** 0332: promissória assinada à mão (folha A4) — vale como assinada, sem travar a entrega. */
export interface PromissoriaPapel { id: string; cycle_id: string; maleta: string; valor_cents: number | null; registrado_em: string; tem_foto: boolean; observacao: string | null; registrado_por: string }
type Dados = { documentos: DocAssinatura[]; maletas: Maleta[]; papel?: PromissoriaPapel[] };

const STATUS: Record<DocAssinatura["status"], { rotulo: string; cor: string }> = {
  pendente: { rotulo: "Aguardando assinatura", cor: "text-amber-600" },
  assinado: { rotulo: "Assinado", cor: "text-emerald-600" },
  recusado: { rotulo: "Recusado", cor: "text-destructive" },
  cancelado: { rotulo: "Cancelado", cor: "text-muted-foreground" },
  erro: { rotulo: "Erro", cor: "text-destructive" },
};
const brl = (c: number | null) => ((c ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (s: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "");
const msg = (e: unknown) => (e instanceof Error ? e.message : "Falha.");

/**
 * 0300 (Diego, 12/11/2026): quem mora no sítio e não usa e-mail recebe o link por SMS.
 * A ZapSign só manda o link sozinha por WhatsApp ou e-mail; o SMS sai do celular de quem está atendendo,
 * já com o número dela e a mensagem prontos (abre o aplicativo de mensagens do aparelho).
 */
export function linkSms(telefone: string | null | undefined, url: string, tipo: "contrato" | "promissoria") {
  const d = (telefone ?? "").replace(/\D/g, "");
  const num = d.length === 10 || d.length === 11 ? `+55${d}` : d.length === 12 || d.length === 13 ? `+${d}` : "";
  const texto = `LARDAN Semijoias: segue o link para você assinar ${tipo === "contrato" ? "o contrato de consignação" : "a nota promissória da sua maleta"}: ${url}`;
  return `sms:${num}?&body=${encodeURIComponent(texto)}`;
}

/** Documentos da consultora + conferência automática na ZapSign dos pendentes (uma vez por tela aberta). */
export function useAssinaturas(party: string, rep: string | null) {
  const qc = useQueryClient();
  const verificarFn = useServerFn(zapsignVerificar);
  const chave = React.useMemo(() => ["assinaturas", party], [party]);
  const q = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data: d, error } = await supabase.rpc("assinaturas_da_consultora" as never, { _party: party, _rep: rep } as never);
      if (error) throw error;
      return d as unknown as Dados;
    },
    refetchInterval: (qq) => ((qq.state.data as Dados | undefined)?.documentos.some((d) => d.status === "pendente") ? 20_000 : false),
  });
  const conferidos = React.useRef(new Set<string>());
  const [verificando, setVerificando] = React.useState<string | null>(null);

  const verificar = React.useCallback(async (id: string, avisar: boolean) => {
    setVerificando(id);
    try {
      const r = await verificarFn({ data: { id, rep } });
      if (avisar) {
        if (r.status === "assinado") toast.success("Assinado! Já está confirmado no sistema.");
        else toast.info("Ainda não assinou. Peça para ela abrir o link e concluir.");
      }
      await qc.invalidateQueries({ queryKey: chave });
      void qc.invalidateQueries({ queryKey: ["rep"] });
    } catch (e) {
      if (avisar) toast.error(msg(e));
    } finally {
      setVerificando(null);
    }
  }, [verificarFn, rep, qc, chave]);

  // Ao abrir: confere na ZapSign cada pendente uma vez (o aviso automático pode ter atrasado).
  const pendentes = (q.data?.documentos ?? []).filter((d) => d.status === "pendente" && (d.tipo === "contrato" || d.tipo === "promissoria"));
  const idsPendentes = pendentes.map((d) => d.id).join(",");
  React.useEffect(() => {
    for (const id of idsPendentes ? idsPendentes.split(",") : []) {
      if (conferidos.current.has(id)) continue;
      conferidos.current.add(id);
      void verificar(id, false);
    }
  }, [idsPendentes, verificar]);

  return { q, chave, verificar, verificando };
}

/**
 * soMaleta (0332): mostra só a promissória desta maleta (cartão "Para entregar em mãos"), sem o contrato.
 */
export function AssinaturaDigital({ party, rep, telefone, soMaleta }: { party: string; rep: string | null; telefone?: string | null; soMaleta?: string }) {
  const qc = useQueryClient();
  const enviarFn = useServerFn(zapsignEnviar);
  const arquivoFn = useServerFn(zapsignArquivo);
  const { q, chave, verificar, verificando } = useAssinaturas(party, rep);
  const enviar = useMutation({
    mutationFn: (v: { tipo: "contrato" | "promissoria"; cycleId?: string; reenviar?: boolean }) =>
      enviarFn({ data: { tipo: v.tipo, partyId: party, cycleId: v.cycleId ?? null, rep, reenviar: v.reenviar ?? false } }),
    onSuccess: (r) => {
      if (r.jaExistia) toast.info("Já existe um documento aguardando assinatura. Copie o link ou use 'Reenviar'.");
      else toast.success(r.whatsapp ? "Enviado pelo WhatsApp da consultora." : "Documento criado. Copie o link e mande para ela.");
      void qc.invalidateQueries({ queryKey: chave }); void qc.invalidateQueries({ queryKey: ["rep"] });
    },
    onError: (e) => toast.error(msg(e)),
  });
  const copiar = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success("Link copiado."); } catch { toast.message(url); }
  };
  const baixar = async (id: string) => {
    try {
      const r = await arquivoFn({ data: { id, rep } });
      if (r.url) window.open(r.url, "_blank", "noopener,noreferrer"); else toast.error("Arquivo ainda não disponível.");
      void qc.invalidateQueries({ queryKey: chave });
    } catch (e) { toast.error(msg(e)); }
  };

  const docs = q.data?.documentos ?? [];
  const contrato = docs.find((d) => d.tipo === "contrato" && d.status !== "cancelado");
  const promissoriaDa = (cycle: string) => docs.find((d) => d.tipo === "promissoria" && d.cycle_id === cycle && d.status !== "cancelado" && !d.invalidada_em);

  const Linha = ({ d }: { d: DocAssinatura }) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs" data-situacao={d.status}>
        {d.status === "assinado" && <CircleCheckBig className="size-4 text-emerald-600" aria-hidden />}
        <span className={`font-semibold ${STATUS[d.status].cor}`}>{STATUS[d.status].rotulo}</span>
        <span className="text-muted-foreground">{d.status === "assinado" ? `em ${data(d.assinado_em)}` : `enviado em ${data(d.criado_em)}`}</span>
        {d.ambiente === "sandbox" && <span className="rounded bg-muted px-1.5">teste</span>}
        {d.invalidada_em && <span className="rounded bg-muted px-1.5 font-medium" title={d.invalidada_motivo ?? undefined}>Substituída — maleta transferida</span>}
        {d.status === "assinado" && <button type="button" className="underline" onClick={() => void baixar(d.id)}>baixar assinado</button>}
      </div>
      {d.sign_url && d.status === "pendente" && (
        <div className="grid grid-cols-2 gap-2">
          <a href={linkSms(telefone, d.sign_url, d.tipo)}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-semibold">
            <MessageSquareText className="size-4" aria-hidden /> Mandar por SMS
          </a>
          <button type="button" onClick={() => void copiar(d.sign_url!)}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-semibold">
            <Copy className="size-4" aria-hidden /> Copiar link
          </button>
        </div>
      )}
      {d.status === "pendente" && (
        <button type="button" disabled={verificando === d.id} onClick={() => void verificar(d.id, true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 text-xs font-semibold text-primary disabled:opacity-60">
          {verificando === d.id ? <Loader2 className="size-3.5 animate-spin" /> : <SearchCheck className="size-3.5" />}
          {verificando === d.id ? "Verificando na ZapSign…" : "Verificar se já assinou"}
        </button>
      )}
    </div>
  );

  const papelDa = (cycle: string) => (q.data?.papel ?? []).find((x) => x.cycle_id === cycle) ?? null;
  const maletas = (q.data?.maletas ?? []).filter((m) => !soMaleta || m.cycle_id === soMaleta);

  return (
    <section className="space-y-3 rounded-2xl border border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><FileSignature className="size-4" /> {soMaleta ? "Promissória desta maleta" : "Assinatura digital"}</h3>
      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {q.error && <p className="text-sm text-destructive">{msg(q.error)}</p>}
      {q.data && (
        <>
          {soMaleta && <p className="text-xs text-muted-foreground">Não trava a entrega: pode assinar pelo celular (ZapSign) ou no papel.</p>}
          {!soMaleta && <div className="space-y-1.5 rounded-xl bg-muted/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Contrato de consignação</p>
              {(!contrato || contrato.status === "recusado" || contrato.status === "erro") ? (
                <button type="button" disabled={enviar.isPending} onClick={() => enviar.mutate({ tipo: "contrato" })}
                  className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">Enviar para assinar</button>
              ) : contrato.status === "pendente" ? (
                <button type="button" disabled={enviar.isPending} onClick={() => enviar.mutate({ tipo: "contrato", reenviar: true })}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-xs"><RefreshCw className="size-3" /> Reenviar</button>
              ) : null}
            </div>
            {contrato && <Linha d={contrato} />}
          </div>}

          {maletas.length === 0 && <p className="text-xs text-muted-foreground">{soMaleta ? "A promissória aparece quando a maleta estiver em nome dela." : "A promissória aparece aqui quando ela tiver uma maleta."}</p>}
          {maletas.map((m) => {
            const p = promissoriaDa(m.cycle_id);
            const papel = papelDa(m.cycle_id);
            return (
              <div key={m.cycle_id} className="space-y-1.5 rounded-xl bg-muted/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Promissória · maleta {m.maleta}{m.remessa ? ` · remessa ${m.remessa}` : ""} · {brl(m.valor_cents)}</p>
                  {papel ? null : (!p || p.status === "recusado" || p.status === "erro") ? (
                    <button type="button" disabled={enviar.isPending} onClick={() => enviar.mutate({ tipo: "promissoria", cycleId: m.cycle_id })}
                      className="h-9 shrink-0 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">Enviar para assinar</button>
                  ) : p.status === "pendente" ? (
                    <button type="button" disabled={enviar.isPending} onClick={() => enviar.mutate({ tipo: "promissoria", cycleId: m.cycle_id, reenviar: true })}
                      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-xs"><RefreshCw className="size-3" /> Reenviar</button>
                  ) : null}
                </div>
                {p && (!papel || p.status === "assinado") && <Linha d={p} />}
                {p?.status !== "assinado" && (
                  <PromissoriaNoPapel party={party} rep={rep} cycleId={m.cycle_id} papel={papel} aoMudar={() => { void qc.invalidateQueries({ queryKey: chave }); void qc.invalidateQueries({ queryKey: ["rep"] }); }} />
                )}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

/** Selo curto para a lista das novas consultoras: "Contrato assinado" / "Contrato pendente". */
export function SeloContrato({ party, rep }: { party: string; rep: string | null }) {
  const { q } = useAssinaturas(party, rep);
  const docs = q.data?.documentos ?? [];
  const contrato = docs.find((d) => d.tipo === "contrato" && d.status !== "cancelado");
  if (!q.data) return null;
  if (!contrato) return <span className="rounded-full bg-muted px-2 py-0.5 text-[0.7rem] text-muted-foreground">Contrato não enviado</span>;
  return contrato.status === "assinado"
    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[0.7rem] font-semibold text-emerald-700"><CircleCheckBig className="size-3" /> Contrato assinado</span>
    : <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-700">Contrato {STATUS[contrato.status].rotulo.toLowerCase()}</span>;
}

/**
 * 0332 (Diego 17/11): consultora mais velha assina a promissória no papel. Imprime a mesma promissória A4
 * da montagem e registra "ela assinou no papel" (foto da folha opcional). Nunca trava a entrega.
 */
function PromissoriaNoPapel({ party, rep, cycleId, papel, aoMudar }: {
  party: string; rep: string | null; cycleId: string; papel: PromissoriaPapel | null; aoMudar: () => void;
}) {
  const registrarFn = useServerFn(promissoriaPapelComFoto);
  const [abrindo, setAbrindo] = React.useState(false);
  const [foto, setFoto] = React.useState<File | null>(null);
  const [imprimindo, setImprimindo] = React.useState(false);
  const registrar = useMutation({
    mutationFn: async () => {
      const f = foto ? await fotoReduzida(foto) : null;
      return registrarFn({ data: { rep, cycleId, foto: f?.base64 ?? null, tipo: f?.tipo ?? null } });
    },
    onSuccess: (r) => {
      toast.success(foto && !r.foto ? "Registrado como assinada no papel. A foto não subiu; pode guardar a folha." : "Registrado: promissória assinada no papel.");
      setAbrindo(false); setFoto(null); aoMudar();
    },
    onError: (e) => toast.error(msg(e)),
  });
  const desfazer = useMutation({
    mutationFn: (motivo: string) => promissoriaPapelCancelar(rep, papel!.id, motivo),
    onSuccess: () => { toast.success("Registro do papel desfeito."); aoMudar(); },
    onError: (e) => toast.error(msg(e)),
  });
  const imprimir = async () => {
    setImprimindo(true);
    try {
      const d = await promissoriaDadosImpressao(rep, cycleId);
      if (!d.valor_cents) { toast.error("A maleta ainda não tem peças para a promissória."); return; }
      if (!imprimirA4("Nota Promissória", htmlPromissoria(d, d.valor_cents, d.maleta))) toast.error("Não foi possível abrir a impressão neste aparelho.");
    } catch (e) { toast.error(msg(e)); } finally { setImprimindo(false); }
  };

  if (papel) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs" data-situacao="papel">
        <CircleCheckBig className="size-4 text-emerald-600" aria-hidden />
        <span className="font-semibold text-emerald-600">Assinada no papel</span>
        <span className="text-muted-foreground">em {data(papel.registrado_em)} · por {papel.registrado_por}{papel.tem_foto ? " · com foto" : ""}</span>
        <button type="button" className="underline text-muted-foreground" disabled={desfazer.isPending}
          onClick={() => { const m = window.prompt("Por que desfazer o registro do papel? (mínimo 5 letras)"); if (m) desfazer.mutate(m); }}>desfazer</button>
      </div>
    );
  }
  return (
    <div className="space-y-2 border-t border-border/60 pt-2" data-party={party}>
      <p className="text-xs text-muted-foreground">Prefere no papel?</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => void imprimir()} disabled={imprimindo}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-semibold disabled:opacity-60">
          {imprimindo ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" aria-hidden />} Imprimir A4
        </button>
        <button type="button" onClick={() => setAbrindo((v) => !v)}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-semibold">
          <PenLine className="size-4" aria-hidden /> Assinou no papel
        </button>
      </div>
      {abrindo && (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <Camera className="size-4" aria-hidden />
            <span>{foto ? `Foto: ${foto.name}` : "Tirar foto da folha assinada (opcional)"}</span>
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
          </label>
          <button type="button" disabled={registrar.isPending} onClick={() => registrar.mutate()}
            className="min-h-11 w-full rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {registrar.isPending ? "Registrando…" : "Confirmar: ela assinou a promissória no papel"}
          </button>
          <p className="text-xs text-muted-foreground">Guarde a folha assinada e entregue na Lardan.</p>
        </div>
      )}
    </div>
  );
}
