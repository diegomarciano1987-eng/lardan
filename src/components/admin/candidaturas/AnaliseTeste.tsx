/**
 * 0284 — bloco "Análise" do card da candidata (só equipe com login). Ordem da tela "Análise do gestor" do protótipo.
 * Nada aqui aprova ou reprova: o sistema sugere; analista e gestor decidem com Serasa e entrevista.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Link2, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/admin/ui";
import { testeAjusteRede, testeSerasa } from "@/lib/candidatura-teste/teste.functions";
import { ALERTA_TEXTO, O_QUE_FAZER, type ResultadoTeste } from "@/lib/candidatura-teste/calculo";
import { FATORES, ORGANIZACAO, PARTE1, RESTRICAO, SITE, type Respostas } from "@/lib/candidatura-teste/perguntas";
import { mesclarParametros, type ParametrosTeste } from "@/lib/candidatura-teste/padrao";
import { wa } from "@/components/representante/AcoesRepresentante";

type Teste = {
  id: string; token: string; origem: string; criado_em: string; expira_em: string; parte: number; concluido_em: string | null; cancelado_em: string | null;
  respostas: Respostas; resultado: ResultadoTeste | null; rp_ajuste: boolean; rp_ajuste_motivo: string | null; rp_ajuste_em: string | null;
  serasa_confere: "sim" | "nao" | null; versao_teste: string | null;
};
const COR: Record<string, string> = {
  verde: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border-emerald-600/40",
  amarelo: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
  vermelho: "bg-destructive/15 text-destructive border-destructive/40",
};
const FX: Record<string, string> = { alta: "alta", media: "média", baixa: "baixa", baixo: "baixo", medio: "médio", alto: "alto" };
const texto = (ops: readonly { codigo: string; texto: string }[], c?: string) => ops.find((o) => o.codigo === c)?.texto ?? "—";
const urlTeste = (t: string) => `${typeof window !== "undefined" ? window.location.origin : "https://www.lardan.com.br"}/candidatura/${t}`;
const horas = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);

function Pilula({ cor, children }: { cor: string; children: React.ReactNode }) {
  return <span className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold uppercase tracking-wide ${COR[cor] ?? "border-line-soft"}`}>{children}</span>;
}
function Numero({ rotulo, valor, faixa }: { rotulo: string; valor: number | string; faixa?: string }) {
  return (
    <div className="rounded-xl border border-line-soft bg-surface p-4">
      <p className="ledger-eyebrow">{rotulo}</p>
      <strong className="num mt-1 block text-3xl text-ledger-text">{valor}</strong>
      {faixa && <p className="text-xs text-ledger-muted">{faixa}</p>}
    </div>
  );
}

export function AnaliseTeste({ leadId, podeEditar }: { leadId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const ajusteFn = useServerFn(testeAjusteRede);
  const serasaFn = useServerFn(testeSerasa);
  const chave = ["candidatura", leadId, "teste"];
  const q = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const [l, t, c] = await Promise.all([
        supabase.from("leads").select("full_name, whatsapp, city, uf, dream, dream_value_cents").eq("id", leadId).maybeSingle(),
        supabase.from("candidatura_testes").select("*").eq("lead_id", leadId).is("cancelado_em", null).order("criado_em", { ascending: false }),
        supabase.from("candidatura_teste_config").select("params").order("criado_em", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (l.error) throw l.error; if (t.error) throw t.error;
      return { lead: l.data, testes: (t.data ?? []) as unknown as Teste[], params: mesclarParametros((c.data?.params ?? null) as Partial<ParametrosTeste> | null) };
    },
  });
  const gerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("candidatura_teste_gerar", { _lead: leadId });
      if (error) throw error;
      return data as unknown as { token: string; novo: boolean };
    },
    onSuccess: (r) => { toast.success(r.novo ? "Link do teste criado." : "Este é o link que já estava aberto."); void qc.invalidateQueries({ queryKey: chave }); },
    onError: (e: Error) => toast.error(e.message.includes("sem_permissao") ? "Sem permissão para gerar o link." : e.message),
  });
  const [motivo, setMotivo] = React.useState("");
  const ajuste = useMutation({
    mutationFn: (v: { teste: string; aplicar: boolean }) => ajusteFn({ data: { ...v, motivo } }),
    onSuccess: () => { toast.success("Análise recalculada."); setMotivo(""); void qc.invalidateQueries({ queryKey: chave }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const serasa = useMutation({
    mutationFn: (v: { teste: string; valor: "sim" | "nao" | null }) => serasaFn({ data: v }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chave }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <Panel title="Análise"><p className="text-sm text-ledger-muted">Carregando…</p></Panel>;
  if (q.error) return <Panel title="Análise"><p role="alert" className="text-sm text-destructive">{(q.error as Error).message}</p></Panel>;
  const { lead, testes, params } = q.data!;
  const feito = testes.find((t) => t.concluido_em && t.resultado);
  const aberto = testes.find((t) => !t.concluido_em && new Date(t.expira_em) > new Date());
  const primeiro = (lead?.full_name ?? "").split(" ")[0] ?? "";
  const msg = (t: string) => `Olá, ${primeiro}! Aqui é da Lardan Semijoias. Este é o link do seu teste de candidatura, leva uns 10 minutos e fica salvo a cada tela: ${urlTeste(t)}`;

  const blocoLink = (
    <div className="rounded-xl border border-line-soft bg-surface p-4">
      <p className="ledger-eyebrow mb-2">Link do teste</p>
      {aberto ? (
        <div className="space-y-2 text-sm">
          <p className="text-ledger-muted">Aberto desde {new Date(aberto.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · parte {Math.min(aberto.parte, 3)} de 3 · vence {new Date(aberto.expira_em).toLocaleDateString("pt-BR")}</p>
          {horas(aberto.criado_em) >= 48 && <p role="alert" className="font-semibold text-destructive">Parado há {horas(aberto.criado_em)} h sem concluir: cobrar o teste.</p>}
          <div className="flex flex-wrap gap-2">
            <a className="admin-btn admin-btn-primary" href={wa(lead?.whatsapp, msg(aberto.token))} target="_blank" rel="noreferrer"><MessageCircle aria-hidden className="size-4" /> Mandar no WhatsApp</a>
            <button type="button" className="admin-btn" onClick={() => { void navigator.clipboard.writeText(urlTeste(aberto.token)); toast.success("Link copiado."); }}><Copy aria-hidden className="size-4" /> Copiar link</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-ledger-muted">{feito ? "Teste concluído. Gere outro link só se for preciso refazer." : "Nenhum link aberto."}</p>
          {podeEditar && <button type="button" className="admin-btn admin-btn-primary" disabled={gerar.isPending} onClick={() => gerar.mutate()}><Link2 aria-hidden className="size-4" /> {feito ? "Gerar novo link" : "Gerar link do teste"}</button>}
        </div>
      )}
    </div>
  );

  const sonho = lead?.dream ? (
    <p className="text-sm text-ledger-text">Sonho: <strong>{lead.dream}</strong>{lead.dream_value_cents ? ` · ${(Number(lead.dream_value_cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}</p>
  ) : null;

  if (!feito?.resultado) {
    return <Panel title="Análise"><div className="space-y-4">{sonho}{blocoLink}<p className="text-sm text-ledger-muted">A análise aparece aqui quando ela concluir as 3 partes.</p></div></Panel>;
  }
  const r = feito.resultado; const resp = feito.respostas;
  const p = params; const pr = p.pesos;
  const principal = r.disc_principal;
  const linhasR: [string, string, number][] = [
    ["R1 " + PARTE1.contatos_semana.pergunta, texto(PARTE1.contatos_semana.opcoes, resp.contatos_semana), r.r.r1],
    ["R2 " + PARTE1.publico_feminino.pergunta, texto(PARTE1.publico_feminino.opcoes, resp.publico_feminino), r.r.r2],
    ["R3 " + PARTE1.onde_pretende_vender.pergunta, (resp.onde_pretende_vender ?? []).map((c) => texto(PARTE1.onde_pretende_vender.opcoes, c)).join(", ") || "—", r.r.r3],
    ["R4 " + SITE.experiencia_venda.pergunta, texto(SITE.experiencia_venda.opcoes, resp.experiencia_venda), r.r.r4],
    ["R5 " + PARTE1.contatos_whatsapp.pergunta, texto(PARTE1.contatos_whatsapp.opcoes, resp.contatos_whatsapp), r.r.r5],
    ["R6 " + SITE.horas_semana.pergunta, texto(SITE.horas_semana.opcoes, resp.horas_semana), r.r.r6],
  ];
  const alertasDisc = r.alertas.filter((a) => a.startsWith("disc_") || a === "dinheiro_disc" || a === "fiado_perfil" || a === "concorda_tudo");
  const alertasRisco = r.alertas.filter((a) => !alertasDisc.includes(a));
  const resumo = [
    `Candidata: ${lead?.full_name ?? ""} · ${lead?.city ?? ""}/${lead?.uf ?? ""}`,
    `Semáforo: ${r.semaforo_final}${r.rebaixado ? " (rebaixado pelo risco de acerto)" : ""}`,
    `Rede ${r.rp} (${FX[r.rp_faixa]}) · Aptidão ${r.av} (${FX[r.av_faixa]}) · IPL ${r.ipl.toLocaleString("pt-BR")}`,
    `Perfil DISC: ${r.disc_perfil} (D ${r.disc.D}, I ${r.disc.I}, S ${r.disc.S}, C ${r.disc.C})`,
    `Risco de acerto: ${FX[r.risco_acerto]} (IOA ${r.ioa})`,
    `Público sugerido: ${r.publico_sugerido}`,
    lead?.dream ? `Sonho: ${lead.dream}` : "",
  ].filter(Boolean).join("\n");

  return (
    <Panel title="Análise">
      <div className="space-y-6 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-ledger-text">{lead?.full_name}</p>
            <p className="text-ledger-muted">{lead?.city}/{lead?.uf} · {lead?.whatsapp} · {resp.local_trabalho ?? "—"}</p>
            {sonho}
          </div>
          <div className="text-right">
            <Pilula cor={r.semaforo_final}>{r.semaforo_final}</Pilula>
            {r.rebaixado && <p className="mt-1 text-xs text-ledger-muted">rebaixado pelo risco de acerto</p>}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Numero rotulo="Rede (RP)" valor={r.rp} faixa={`faixa ${FX[r.rp_faixa]}`} />
          <Numero rotulo="Aptidão DISC (AV)" valor={r.av} faixa={`faixa ${FX[r.av_faixa]}`} />
          <Numero rotulo="IPL" valor={r.ipl.toLocaleString("pt-BR")} faixa="ordena a fila dentro da mesma cor" />
        </div>

        <div className="rounded-xl border border-line-soft bg-surface p-4">
          <p className="ledger-eyebrow mb-1">O que fazer</p>
          <p className="text-ledger-text">{O_QUE_FAZER[r.semaforo_final]}</p>
          <p className="mt-1 text-ledger-muted">Critério "Público" da nota 0–16: sugerido <strong className="text-ledger-text">{r.publico_sugerido}</strong> (a analista pode mudar).</p>
        </div>

        <section className="space-y-3">
          <div className="flex items-center gap-3"><h3 className="text-base font-semibold text-ledger-text">Risco de acerto</h3>
            <Pilula cor={r.risco_acerto === "alto" ? "vermelho" : r.risco_acerto === "medio" ? "amarelo" : "verde"}>{FX[r.risco_acerto]}</Pilula></div>
          <table className="w-full text-left">
            <tbody>
              {ORGANIZACAO.map((o) => (
                <tr key={o.id} className="border-b border-line-soft align-top">
                  <td className="py-2 pr-3 text-ledger-muted">{o.id.toUpperCase()} {o.pergunta}</td>
                  <td className="py-2 pr-3 text-ledger-text">{texto(o.opcoes, resp[o.id])}{r.sinais_criticos.includes(o.id) && <strong className="ml-1 text-destructive">⚠</strong>}</td>
                  <td className="num py-2 text-right">{r.o[o.id]}</td>
                </tr>
              ))}
              <tr><td className="py-2 pr-3 text-ledger-muted">{RESTRICAO.pergunta}</td><td className="py-2 text-ledger-text" colSpan={2}>{texto(RESTRICAO.opcoes, resp.restricao_declarada)}</td></tr>
            </tbody>
          </table>
          <p className="text-ledger-muted">IOA = {pr.ioa_o} × {r.o_soma} + {pr.ioa_disciplina} × {r.disciplina} (disciplina) + {pr.ioa_cs} × {Math.max(0, Math.min(100, 50 + 2.5 * (r.disc.C + r.disc.S)))} (C+S) = <strong className="text-ledger-text">{r.ioa}</strong> · sinais críticos: {r.sinais_criticos.length}</p>
          {alertasRisco.length > 0 && <ul className="list-disc space-y-1 pl-5">{alertasRisco.map((a) => <li key={a}>{ALERTA_TEXTO[a] ?? a}</li>)}</ul>}
          <div className="rounded-xl border border-dashed border-line p-4">
            <p className="font-semibold text-ledger-text">Conferir no Serasa / perfil comercial</p>
            <p className="text-ledger-muted">Valor e data da restrição; dívidas com empresas de venda direta ou consignado; se bate com o declarado.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span>Serasa confere com o declarado?</span>
              {(["sim", "nao"] as const).map((v) => (
                <button key={v} type="button" disabled={!podeEditar || serasa.isPending} aria-pressed={feito.serasa_confere === v}
                  onClick={() => serasa.mutate({ teste: feito.id, valor: feito.serasa_confere === v ? null : v })}
                  className={`admin-btn h-8 px-3 text-xs ${feito.serasa_confere === v ? "admin-btn-primary" : ""}`}>{v === "sim" ? "Sim" : "Não"}</button>
              ))}
              {feito.serasa_confere === "nao" && <strong className="text-destructive">Não confere: com restrição grave, alerta vermelho.</strong>}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-base font-semibold text-ledger-text">Perfil DISC: {r.disc_perfil}</h3>
          <div className="space-y-2">
            {FATORES.map((f) => (
              <div key={f} className="grid grid-cols-[1.5rem_1fr_4rem] items-center gap-2">
                <strong>{f}</strong>
                <div className="h-2.5 rounded-full bg-muted"><div className="h-2.5 rounded-full bg-primary" style={{ width: `${r.disc_pct[f]}%` }} /></div>
                <span className="num text-right text-ledger-muted">{r.disc_pct[f]}% ({r.disc[f] > 0 ? "+" : ""}{r.disc[f]})</span>
              </div>
            ))}
          </div>
          <p className="text-ledger-muted">AV = {pr.av_disc} × {Math.max(0, Math.min(100, 50 + 2.5 * r.disc.I))} (I) + {pr.av_iniciativa} × {r.iniciativa} (iniciativa) = <strong className="text-ledger-text">{r.av}</strong>{r.disc_segundos !== null ? ` · tempo no perfil: ${Math.floor(r.disc_segundos / 60)} min ${r.disc_segundos % 60} s` : ""}</p>
          {alertasDisc.length > 0 && <ul className="list-disc space-y-1 pl-5">{alertasDisc.map((a) => <li key={a}>{ALERTA_TEXTO[a] ?? a}</li>)}</ul>}
        </section>

        <section className="space-y-3">
          <h3 className="text-base font-semibold text-ledger-text">Rede / Público</h3>
          <table className="w-full text-left"><tbody>
            {linhasR.map(([q1, a, pt]) => <tr key={q1} className="border-b border-line-soft align-top"><td className="py-2 pr-3 text-ledger-muted">{q1}</td><td className="py-2 pr-3 text-ledger-text">{a}</td><td className="num py-2 text-right">{pt}</td></tr>)}
            <tr><td className="py-2 text-ledger-muted" colSpan={2}>Total{feito.rp_ajuste ? ` (com ajuste +${p.ajuste_rp})` : ""}</td><td className="num py-2 text-right font-semibold">{r.rp}</td></tr>
          </tbody></table>
          {podeEditar && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line-soft p-3">
              {feito.rp_ajuste ? (
                <>
                  <span>Ajuste +{p.ajuste_rp} aplicado: {feito.rp_ajuste_motivo}</span>
                  <button type="button" className="admin-btn h-8 px-3 text-xs" disabled={ajuste.isPending} onClick={() => ajuste.mutate({ teste: feito.id, aplicar: false })}>Retirar ajuste</button>
                </>
              ) : (
                <>
                  <input className="admin-input w-80 max-w-full" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo do ajuste +15 (obrigatório)" />
                  <button type="button" className="admin-btn h-9 px-3 text-xs" disabled={motivo.trim().length < 5 || ajuste.isPending} onClick={() => ajuste.mutate({ teste: feito.id, aplicar: true })}>Aplicar ajuste +{p.ajuste_rp}</button>
                </>
              )}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-semibold text-ledger-text">Entrevista e acompanhamento ({principal})</h3>
          {p.textos.entrevista[principal] || p.textos.acompanhamento[principal] ? (
            <>
              {p.textos.entrevista[principal] && <p className="whitespace-pre-line text-ledger-text">{p.textos.entrevista[principal]}</p>}
              {p.textos.acompanhamento[principal] && <p className="whitespace-pre-line text-ledger-muted">{p.textos.acompanhamento[principal]}</p>}
            </>
          ) : <p className="text-ledger-muted">Os textos de entrevista e acompanhamento do protótipo ainda não foram cadastrados em Configurações do teste.</p>}
        </section>

        <div className="rounded-xl border border-line-soft bg-surface p-4">
          <div className="mb-2 flex items-center justify-between gap-2"><p className="ledger-eyebrow">Resumo para copiar</p>
            <button type="button" className="admin-btn h-8 px-3 text-xs" onClick={() => { void navigator.clipboard.writeText(resumo); toast.success("Resumo copiado."); }}><Copy aria-hidden className="size-3.5" /> Copiar</button></div>
          <pre className="whitespace-pre-wrap font-sans text-ledger-text">{resumo}</pre>
        </div>

        {blocoLink}
        <p className="text-xs text-ledger-muted">Versão do teste {feito.versao_teste ?? r.versao_teste}. Nenhum resultado do teste pode ser usado como motivo de recusa.</p>
      </div>
    </Panel>
  );
}
