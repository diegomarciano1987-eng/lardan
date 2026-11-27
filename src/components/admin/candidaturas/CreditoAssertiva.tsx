/**
 * 0394 — bloco "Crédito (Assertiva)" na análise da candidata.
 * Mostra a última consulta, a regra por idade aplicada e o histórico. Consultar custa (cobrado pela Assertiva), então
 * o botão pede confirmação e o servidor reaproveita a consulta dos últimos 30 dias, a não ser que peçam uma nova.
 * Nada aqui reprova: "revisar" vai para a análise do Daniel.
 * 0395: mostra também a decisão da Captação (aprovada automaticamente ou foi para a análise, com os motivos).
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/admin/ui";
import { creditoConsultar, nascimentoDefinir } from "@/lib/credito/credito.functions";
import { cn } from "@/lib/utils";
import { DateField } from "@/components/premium/DateField";
import { format } from "date-fns";

type Consulta = {
  id: string; em: string; origem: string; por: string | null; situacao: string; score: number | null; classe: string | null;
  faixa: string | null; protestos_qtd: number | null; protestos_valor: number | null; debitos_qtd: number | null;
  debitos_valor: number | null; renda_presumida: number | null; idade: number | null; score_minimo: number | null;
  resultado: "aprovada_regra" | "revisar"; motivo: string; protocolo: string | null;
};
type Decisao = {
  requisitos?: { documentos: boolean };
  canal: "site" | "representante"; como_conheceu: string | null; na_fila: boolean; erro_fila: string | null;
  ultima: { em: string; decisao: "aprovada_automatica" | "revisao"; motivos: string[]; semaforo: string | null; score: number | null; score_minimo: number | null } | null;
};
const COMO: Record<string, string> = { indicacao: "Indicação", instagram: "Instagram", google: "Google", outro: "Outro" };
type Credito = { data_nascimento: string | null; idade: number | null; regras: { de: number; ate: number; score_min: number }[]; consultas: Consulta[] };

const brl = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dataBR = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function CreditoAssertiva({ leadId, podeEditar }: { leadId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const consultar = useServerFn(creditoConsultar);
  const salvarNasc = useServerFn(nascimentoDefinir);
  const [confirmar, setConfirmar] = React.useState<null | { forcar: boolean }>(null);
  const [nasc, setNasc] = React.useState("");

  const q = useQuery({
    queryKey: ["crm", "credito", leadId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("candidatura_credito_ver" as never, { _lead: leadId } as never);
      if (error) throw error;
      return data as unknown as Credito;
    },
  });
  const dec = useQuery({
    queryKey: ["crm", "captacao-decisao", leadId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("captacao_decisao_ver" as never, { _lead: leadId } as never);
      if (error) throw error;
      return data as unknown as Decisao;
    },
  });
  const atualizar = () => void qc.invalidateQueries({ queryKey: ["crm"] });

  const mConsultar = useMutation({
    mutationFn: (forcar: boolean) => consultar({ data: { lead: leadId, forcar } }),
    onSuccess: (r) => {
      setConfirmar(null);
      if (r.reaproveitada) toast.info("Já existe consulta dos últimos 30 dias: mostrando a mesma.");
      else if (r.resultado === "aprovada_regra") toast.success(`Dentro da regra: ${r.motivo}`);
      else toast.warning(`Revisar: ${r.motivo}`, { duration: 12000 });
      atualizar();
    },
    onError: (e) => {
      setConfirmar(null);
      toast.error((e as Error).message);
    },
  });
  const mNasc = useMutation({
    mutationFn: () => salvarNasc({ data: { lead: leadId, data: nasc } }),
    onSuccess: () => {
      toast.success("Data de nascimento salva.");
      setNasc("");
      atualizar();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isLoading) return <Panel title="Crédito (Assertiva)"><p className="text-sm text-ledger-muted">Carregando…</p></Panel>;
  if (q.error || !q.data) return <Panel title="Crédito (Assertiva)"><p className="text-sm text-destructive">Não foi possível carregar a consulta de crédito.</p></Panel>;
  const c = q.data;
  const ultima = c.consultas[0];
  const regraAtual = c.idade != null ? c.regras.find((r) => c.idade! >= r.de && c.idade! <= r.ate) : undefined;

  return (
    <Panel title="Captação: crédito e decisão">
      <div className="space-y-4 text-sm">
        {dec.data && (
          <div className="rounded-xl border border-line-soft bg-surface p-4">
            <p className="ledger-eyebrow mb-1">
              Decisão da captação · {dec.data.canal === "representante" ? "captada pelo representante" : "veio pelo site"}
              {dec.data.como_conheceu ? ` · conheceu por ${COMO[dec.data.como_conheceu] ?? dec.data.como_conheceu}` : ""}
            </p>
            {dec.data.ultima ? (
              dec.data.ultima.decisao === "aprovada_automatica" ? (
                <p className="font-semibold text-success">{dec.data.requisitos?.documentos ? `Teste, crédito e documentos completos (${dataBR(dec.data.ultima.em)}).` : `Teste verde e crédito dentro da regra (${dataBR(dec.data.ultima.em)}): aprova sozinha assim que os documentos chegam.`}</p>
              ) : (
                <>
                  <p className="font-semibold text-warning">Foi para a análise em {dataBR(dec.data.ultima.em)} (Daniel ou o representante dela, com os documentos)</p>
                  <ul className="mt-1 list-disc pl-5 text-xs text-ledger-muted">
                    {dec.data.ultima.motivos.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                </>
              )
            ) : dec.data.na_fila ? (
              <p className="text-ledger-muted">
                Teste concluído: consulta de crédito e decisão em andamento (em até alguns minutos).
                {dec.data.erro_fila ? ` Última tentativa: ${dec.data.erro_fila}` : ""}
              </p>
            ) : (
              <p className="text-ledger-muted">A decisão sai sozinha depois que a candidata concluir o teste.</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span>
            <span className="ledger-eyebrow mr-2">Nascimento</span>
            {c.data_nascimento ? `${new Date(`${c.data_nascimento}T12:00:00`).toLocaleDateString("pt-BR")} · ${c.idade} anos` : "não informado"}
          </span>
          <span>
            <span className="ledger-eyebrow mr-2">Score mínimo para a idade</span>
            {regraAtual ? regraAtual.score_min : "—"}
          </span>
        </div>

        {!c.data_nascimento && podeEditar && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
              Data de nascimento (para aplicar a regra por idade)
              <DateField
                value={nasc ? new Date(`${nasc}T12:00:00`) : undefined}
                onChange={(d) => setNasc(d ? format(d, "yyyy-MM-dd") : "")}
                fromYear={1920}
                toYear={new Date().getFullYear() - 18}
                shortcuts={false}
              />
            </label>
            <button type="button" className="admin-btn" disabled={!nasc || mNasc.isPending} onClick={() => mNasc.mutate()}>
              Salvar
            </button>
          </div>
        )}

        {ultima ? (
          <div className={cn("rounded-xl border p-4", ultima.resultado === "aprovada_regra" ? "border-success/40 bg-success/10" : "border-warning/40 bg-warning/10")}>
            <p className="font-semibold text-ledger-text">
              {ultima.resultado === "aprovada_regra" ? "Dentro da regra" : "Revisar"}
              {ultima.score != null && <span className="ml-2 num">· score {ultima.score}{ultima.classe ? ` (classe ${ultima.classe})` : ""}</span>}
            </p>
            <p className="mt-1 text-xs text-ledger-muted">{ultima.motivo}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
              <div><dt className="ledger-eyebrow">Faixa</dt><dd>{ultima.faixa ?? "—"}</dd></div>
              <div><dt className="ledger-eyebrow">Protestos</dt><dd className="num">{ultima.protestos_qtd ?? 0} · {brl(ultima.protestos_valor)}</dd></div>
              <div><dt className="ledger-eyebrow">Débitos</dt><dd className="num">{ultima.debitos_qtd ?? 0} · {brl(ultima.debitos_valor)}</dd></div>
              <div><dt className="ledger-eyebrow">Renda presumida</dt><dd className="num">{brl(ultima.renda_presumida)}</dd></div>
            </dl>
            <p className="mt-3 text-[0.6875rem] text-ledger-muted">
              Consultado em {dataBR(ultima.em)} · {ultima.origem === "automatica" ? "automático" : ultima.por ?? "equipe"}
              {ultima.protocolo ? ` · protocolo Assertiva ${ultima.protocolo}` : ""}
            </p>
          </div>
        ) : (
          <p className="text-ledger-muted">Ainda não houve consulta de crédito para esta candidata.</p>
        )}

        {podeEditar && (
          confirmar ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line-soft p-3">
              <span className="text-xs">Cada consulta é cobrada pela Assertiva. Confirmar?</span>
              <button type="button" className="admin-btn admin-btn-primary" disabled={mConsultar.isPending} onClick={() => mConsultar.mutate(confirmar.forcar)}>
                {mConsultar.isPending ? "Consultando…" : "Confirmar consulta"}
              </button>
              <button type="button" className="admin-btn" disabled={mConsultar.isPending} onClick={() => setConfirmar(null)}>Voltar</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {!ultima && (
                <button type="button" className="admin-btn admin-btn-primary" onClick={() => setConfirmar({ forcar: false })}>Consultar crédito na Assertiva</button>
              )}
              {ultima && (
                <button type="button" className="admin-btn" onClick={() => setConfirmar({ forcar: true })}>Fazer nova consulta</button>
              )}
            </div>
          )
        )}

        {c.consultas.length > 1 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-ledger-muted">Consultas anteriores ({c.consultas.length - 1})</summary>
            <ul className="mt-2 space-y-1">
              {c.consultas.slice(1).map((h) => (
                <li key={h.id} className="text-ledger-muted">
                  {dataBR(h.em)} · {h.resultado === "aprovada_regra" ? "dentro da regra" : "revisar"} · {h.motivo}
                </li>
              ))}
            </ul>
          </details>
        )}

        <p className="text-[0.6875rem] text-ledger-muted">
          Regra: {c.regras.map((r) => `${r.de}–${r.ate >= 100 ? "+" : r.ate} anos: mínimo ${r.score_min}`).join(" · ")}. O sistema indica o resultado. Aprovação automática só quando todos os critérios passam; qualquer recusa é revisada por uma pessoa.
        </p>
      </div>
    </Panel>
  );
}
