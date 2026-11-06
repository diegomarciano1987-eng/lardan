/**
 * Botão "Nota fiscal" da maleta: NF-e de remessa consignada montada com a
 * consultora e as peças conferidas da maleta (0214).
 * Nesta versão SÓ HOMOLOGAÇÃO (nota de teste, sem valor fiscal). Emitir: só Master.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Receipt, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { focusConsultar, focusEmitirAcertoMaleta, focusEmitirRemessaMaleta } from "@/lib/focus/focus.functions";
import { imprimirDanfe } from "@/components/admin/fiscal/imprimirDanfe";

export interface NotaMaleta {
  cycle_id: string;
  ref: string;
  ambiente: string;
  status: string;
  status_sefaz: string | null;
  mensagem_sefaz: string | null;
  erros: { mensagem?: string; campo?: string }[] | null;
  numero: string | null;
  serie: string | null;
  tem_danfe: boolean;
  desatualizada: boolean;
  created_at: string;
  /** notas do acerto (devolução, venda, perda) ligadas a esta remessa */
  acerto?: { operacao: "devolucao" | "venda" | "perda"; ref: string; status: string; numero: string | null;
             mensagem_sefaz: string | null; erros: { mensagem?: string }[] | null; tem_danfe: boolean }[];
}

const OPERACAO_ACERTO = { devolucao: "Devolução", venda: "Venda", perda: "Perda" } as const;

/** Situações em que a maleta já foi montada e conferida (e ainda não voltou para acerto). */
export const MALETA_APTA_NOTA = ["conferida", "expedida", "transito", "recebida", "operacao"];
const VIVA = ["pendente", "processando_autorizacao", "autorizado"];
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Falha.");

/** Última nota de remessa de cada maleta (lista vazia para quem não vê o fiscal). */
export function useNotasMaletas(cycleIds: string[]) {
  const consultar = useServerFn(focusConsultar);
  const qc = useQueryClient();
  const chave = [...cycleIds].sort().join(",");
  const q = useQuery({
    queryKey: ["focus", "notas-maletas", chave],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fiscal_focus_notas_maletas" as never, { _cycles: cycleIds } as never);
      if (error) throw error;
      return (data ?? []) as unknown as NotaMaleta[];
    },
    enabled: cycleIds.length > 0,
    staleTime: 15_000,
  });
  // Sem aviso (webhook) a tela pergunta à Focus pelas notas que ainda estão na SEFAZ.
  const naSefaz = (st: string) => st === "processando_autorizacao" || st === "pendente";
  const pendentes = (q.data ?? []).flatMap((n) => [
    ...(naSefaz(n.status) ? [n.ref] : []),
    ...(n.acerto ?? []).filter((a) => naSefaz(a.status)).map((a) => a.ref),
  ]).join(",");
  React.useEffect(() => {
    if (!pendentes) return;
    const t = setInterval(() => {
      void Promise.allSettled(pendentes.split(",").map((ref) => consultar({ data: { ref } }))).then(() =>
        qc.invalidateQueries({ queryKey: ["focus", "notas-maletas"] }));
    }, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendentes]);
  const porMaleta = React.useMemo(() => new Map((q.data ?? []).map((n) => [n.cycle_id, n])), [q.data]);
  const prod = useQuery({
    queryKey: ["focus", "producao-ativa"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fiscal_focus_producao_ativa" as never);
      if (error) return false;
      return Boolean(data);
    },
    staleTime: 60_000,
  });
  return { porMaleta, carregando: q.isLoading, producao: prod.data === true };
}

export function NotaFiscalMaleta({
  cycleId,
  status,
  nota: notaRecebida,
  podeEmitir,
  temConsultora,
  semPecas,
  grande = false,
  producao = false,
}: {
  cycleId: string;
  status: string;
  nota: NotaMaleta | undefined;
  podeEmitir: boolean;
  temConsultora: boolean;
  semPecas: boolean;
  grande?: boolean;
  /** emissão real ligada: os botões deixam de dizer "teste" */
  producao?: boolean;
}) {
  const sufixo = producao ? "" : " (teste)";
  // Emissão real ligada: nota de TESTE (homologação) não conta como nota da maleta (0225).
  const testeAntigo = producao && notaRecebida?.ambiente === "homologacao" ? notaRecebida : undefined;
  const nota = testeAntigo ? undefined : notaRecebida;
  const qc = useQueryClient();
  const emitirFn = useServerFn(focusEmitirRemessaMaleta);
  const tam = grande ? "justify-center" : "h-9 px-3 text-xs";
  const icone = grande ? "size-4" : "size-3.5";

  const emitir = useMutation({
    mutationFn: () => emitirFn({ data: { cycleId } }),
    onSuccess: (r) => {
      if (r.status === "autorizado") toast.success(r.ambiente === "producao" ? "Nota fiscal autorizada pela SEFAZ." : "Nota de teste autorizada pela SEFAZ.");
      else if (r.status === "processando_autorizacao") toast.message("Nota enviada; a SEFAZ está processando.");
      else toast.error(r.mensagem ?? r.erros?.[0]?.mensagem ?? "A SEFAZ recusou a nota.");
    },
    onError: (e) => toast.error(msgErro(e)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["focus", "notas-maletas"] }),
  });
  const emitirAcertoFn = useServerFn(focusEmitirAcertoMaleta);
  const emitirAcerto = useMutation({
    mutationFn: () => emitirAcertoFn({ data: { cycleId } }),
    onSuccess: (r) => {
      const ok = r.resultados.filter((x) => x.status === "autorizado" || x.status === "processando_autorizacao");
      const ruins = r.resultados.filter((x) => !(x.status === "autorizado" || x.status === "processando_autorizacao"));
      if (ok.length) toast.success(`Notas do acerto enviadas: ${ok.map((x) => OPERACAO_ACERTO[x.operacao]).join(", ")}.`);
      for (const x of ruins) toast.error(`${OPERACAO_ACERTO[x.operacao]}: ${x.mensagem ?? "recusada"}`);
      if (r.semNota.length) toast.message(`${r.semNota.reduce((s, x) => s + x.quantidade, 0)} peça(s) ficaram sem nota (nem voltaram, nem vendidas, nem perdidas).`);
    },
    onError: (e) => toast.error(msgErro(e)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["focus", "notas-maletas"] }),
  });
  // DANFE enxuto (0224): gerado do XML autorizado, uma linha por peça
  const abrirDanfe = (ref = nota!.ref) => imprimirDanfe(ref);

  if (nota && nota.status === "autorizado") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <button type="button" className={`admin-btn ${tam}`} onClick={() => void abrirDanfe()} disabled={!nota.tem_danfe}
          title={nota.ambiente === "producao" ? "Nota fiscal real." : "Nota de TESTE (homologação), sem valor fiscal."}>
          <Receipt aria-hidden className={icone} /> {nota.ambiente === "producao" ? "DANFE" : "DANFE teste"}{nota.numero ? ` nº ${nota.numero}` : ""}
        </button>
        {nota.desatualizada && <span className="text-xs text-warning">As peças mudaram depois da nota.</span>}
        {(nota.acerto ?? []).map((a) => a.status === "autorizado" ? (
          <button key={a.ref} type="button" className={`admin-btn ${tam}`} disabled={!a.tem_danfe} onClick={() => void abrirDanfe(a.ref)}
            title="Nota de TESTE (homologação), sem valor fiscal.">
            <Receipt aria-hidden className={icone} /> {OPERACAO_ACERTO[a.operacao]}{a.numero ? ` nº ${a.numero}` : ""}
          </button>
        ) : VIVA.includes(a.status) ? (
          <span key={a.ref} className="text-xs text-ledger-muted">{OPERACAO_ACERTO[a.operacao]} na SEFAZ…</span>
        ) : (
          <span key={a.ref} className="max-w-72 text-xs text-destructive" title={a.mensagem_sefaz ?? ""}>
            {OPERACAO_ACERTO[a.operacao]} recusada: {a.mensagem_sefaz ?? a.erros?.[0]?.mensagem ?? a.status}
          </span>
        ))}
        {status === "encerrada" && (
          <button type="button" className={`admin-btn ${tam}`} disabled={!podeEmitir || emitirAcerto.isPending}
            title={podeEmitir ? "Emite as notas de TESTE de devolução, venda e perda do acerto que ainda faltam." : "Sem permissão para emitir a nota da maleta."}
            onClick={() => emitirAcerto.mutate()}>
            <Receipt aria-hidden className={icone} /> {emitirAcerto.isPending ? "Enviando…" : `Notas do acerto${nota.ambiente === "producao" ? "" : " (teste)"}`}
          </button>
        )}
      </span>
    );
  }
  if (nota && VIVA.includes(nota.status)) {
    return (
      <button type="button" className={`admin-btn ${tam}`} disabled>
        <RefreshCw aria-hidden className={`${icone} animate-spin`} /> Nota na SEFAZ…
      </button>
    );
  }

  const apta = MALETA_APTA_NOTA.includes(status);
  const motivo = !podeEmitir ? "Sem permissão para emitir a nota da maleta."
    : !temConsultora ? "Maleta de abertura: a nota sai quando o representante vincular a consultora."
    : semPecas ? "Maleta sem peças."
    : !apta ? "A nota libera quando a maleta estiver montada e conferida."
    : producao ? "Emite a NF-e REAL de remessa consignada com as peças conferidas."
    : "Emite a NF-e de remessa consignada de TESTE (homologação, sem valor fiscal) com as peças conferidas.";
  const recusa = nota && !VIVA.includes(nota.status) && nota.status !== "cancelado"
    ? (nota.mensagem_sefaz ?? nota.erros?.[0]?.mensagem ?? "A nota anterior não foi autorizada.") : null;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={`admin-btn ${grande ? "admin-btn-primary " : ""}${tam}`} title={motivo}
        disabled={!podeEmitir || !temConsultora || semPecas || !apta || emitir.isPending}
        onClick={() => emitir.mutate()}>
        <Receipt aria-hidden className={icone} />
        {emitir.isPending ? "Enviando…" : recusa ? `Emitir nota de novo${sufixo}` : `Nota fiscal${sufixo}`}
      </button>
      {recusa && <span className="max-w-72 text-xs text-destructive" title={recusa}>Recusada: {recusa}</span>}
      {testeAntigo && <span className="text-xs text-ledger-muted">Já teve nota de teste{testeAntigo.numero ? ` nº ${testeAntigo.numero}` : ""} (sem valor fiscal).</span>}
    </span>
  );
}
