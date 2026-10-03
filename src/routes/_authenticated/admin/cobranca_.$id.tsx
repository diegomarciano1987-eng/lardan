import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, MessageCircle, Phone } from "lucide-react";
import {
  devedor, registrar, moverEtapa, criarPromessa, cancelarPromessa, criarTarefa, concluirTarefa,
  brl, dataBR, hojeSP, ETAPAS, rotuloEtapa, ROTULO_TIPO, ROTULO_PROMESSA, type Etapa,
} from "@/lib/cobranca";

export const Route = createFileRoute("/_authenticated/admin/cobranca_/$id")({
  head: () => ({ meta: [{ title: "Devedora — Cobrança Lardan" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Cockpit,
});

type Aba = "resumo" | "titulos" | "linha" | "promessas" | "agenda" | "dados";

function Cockpit() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cob", "devedor", id], queryFn: () => devedor(id) });
  const [aba, setAba] = React.useState<Aba>("resumo");
  const [acao, setAcao] = React.useState<null | "ligacao" | "negociacao" | "promessa" | "desconto_solicitado" | "retorno" | "negativacao_encaminhada">(null);
  const [sel, setSel] = React.useState<string[]>([]);
  const [obs, setObs] = React.useState("");
  const [resultado, setResultado] = React.useState("sucesso");
  const [valor, setValor] = React.useState("");
  const [data, setData] = React.useState(hojeSP());
  const recarregar = () => qc.invalidateQueries({ queryKey: ["cob"] });

  if (q.isLoading) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;
  if (q.error || !q.data?.pessoa) return <p className="p-6 text-sm text-destructive">{(q.error as Error)?.message ?? "Devedora não encontrada."}</p>;
  const d = q.data;
  const hoje = hojeSP();
  const vencidas = d.parcelas.filter((p) => p.vencimento < hoje);
  const vencido = vencidas.reduce((a, p) => a + Number(p.saldo_cents), 0);
  const aVencer = d.parcelas.filter((p) => p.vencimento >= hoje).reduce((a, p) => a + Number(p.saldo_cents), 0);
  const inicioMes = hoje.slice(0, 8) + "01";
  const recuperadoMes = d.recebimentos.filter((r) => r.data >= inicioMes).reduce((a, r) => a + Number(r.valor_cents) * (r.estorno ? -1 : 1), 0);
  const prox = d.tarefas.find((t) => t.status === "aberta");
  const fone = d.contatos.find((c) => c.tipo === "whatsapp" || c.tipo === "telefone")?.valor?.replace(/\D/g, "");

  const abrirWhats = async () => {
    if (!fone) { toast.error("Sem telefone cadastrado."); return; }
    window.open(`https://wa.me/55${fone.replace(/^55/, "")}`, "_blank", "noopener");
    await registrar({ party: id, tipo: "whatsapp_aberto", obs: "Contato aberto no WhatsApp" });
    recarregar();
  };

  const salvar = async () => {
    try {
      if (acao === "promessa") {
        const cents = Math.round(Number(valor.replace(/\./g, "").replace(",", ".")) * 100);
        if (!cents || !sel.length) { toast.error("Informe valor e parcelas."); return; }
        await criarPromessa({ party: id, valor: cents, data, parcelas: sel, obs });
      } else if (acao === "retorno") {
        await criarTarefa(id, obs.trim() || "Retorno agendado", data);
      } else if (acao) {
        await registrar({ party: id, tipo: acao, resultado: acao === "ligacao" ? resultado : null, obs, parcelas: sel });
      }
      toast.success("Registrado.");
      setAcao(null); setObs(""); setSel([]); setValor(""); recarregar();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não registrou."); }
  };

  const Card = ({ r, v, alerta }: { r: string; v: string; alerta?: boolean }) => (
    <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{r}</p><p className={`mt-1 font-mono text-lg tabular-nums ${alerta ? "text-destructive" : ""}`}>{v}</p></div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <Link to="/admin/cobranca" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Voltar à carteira</Link>
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-card p-6">
        <div>
          <h1 className="font-display text-3xl">{d.pessoa.nome}</h1>
          <p className="text-sm text-muted-foreground">{d.pessoa.documento ?? "Documento não informado"} · {[d.endereco?.cidade, d.endereco?.uf].filter(Boolean).join("/") || "Região não informada"}</p>
          <p className="mt-1 text-sm">Responsável: {d.caso?.responsavel_nome ?? "Não informado"}{d.caso?.pausa_ate && ` · Régua pausada até ${dataBR(d.caso.pausa_ate)} (${d.caso.pausa_motivo})`}</p>
        </div>
        <select value={d.caso?.etapa ?? "novo_atraso"} onChange={async (e) => { await moverEtapa(id, e.target.value as Etapa); recarregar(); }}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm">
          {ETAPAS.map((e) => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
        </select>
      </header>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setAcao("ligacao")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm"><Phone className="h-4 w-4" />Registrar ligação</button>
        <button onClick={abrirWhats} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm"><MessageCircle className="h-4 w-4" />Abrir WhatsApp</button>
        {([["negociacao", "Registrar negociação"], ["promessa", "Registrar promessa"], ["desconto_solicitado", "Solicitar desconto"], ["retorno", "Agendar retorno"], ["negativacao_encaminhada", "Encaminhar negativação"]] as const).map(([k, r]) => (
          <button key={k} onClick={() => setAcao(k)} className="h-10 rounded-lg border border-border px-4 text-sm">{r}</button>
        ))}
      </div>

      {acao && (
        <section className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-5">
          <h3 className="font-medium">{acao === "retorno" ? "Agendar retorno" : acao === "promessa" ? "Promessa de pagamento" : ROTULO_TIPO[acao]}</h3>
          {acao === "desconto_solicitado" && <p className="text-xs text-muted-foreground">Fica como proposta. O valor só muda depois da aprovação pela rotina oficial do financeiro.</p>}
          {acao === "ligacao" && (
            <select value={resultado} onChange={(e) => setResultado(e.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm">
              <option value="sucesso">Atendeu</option><option value="nao_atendeu">Não atendeu</option><option value="recado">Deixei recado</option><option value="sem_sucesso">Sem sucesso</option>
            </select>
          )}
          {(acao === "promessa" || acao === "retorno") && (
            <div className="flex gap-2">
              {acao === "promessa" && <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Valor (R$)" className="h-10 w-40 rounded-lg border border-border bg-background px-3 text-sm" />}
              <input type="text" value={dataBR(data)} onChange={(e) => { const m = e.target.value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) setData(`${m[3]}-${m[2]}-${m[1]}`); }}
                className="h-10 w-36 rounded-lg border border-border bg-background px-3 text-sm" aria-label="Data (dd/mm/aaaa)" />
            </div>
          )}
          {acao !== "retorno" && d.parcelas.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-lg border border-border bg-background p-2 text-sm">
              {d.parcelas.map((p) => (
                <label key={p.installment_id} className="flex items-center gap-2 py-1">
                  <input type="checkbox" checked={sel.includes(p.installment_id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.installment_id] : sel.filter((x) => x !== p.installment_id))} />
                  {p.numero ?? "Título"} · venc. {dataBR(p.vencimento)} · <span className="font-mono">{brl(Number(p.saldo_cents))}</span>
                </label>
              ))}
            </div>
          )}
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação" rows={3} className="w-full rounded-lg border border-border bg-background p-3 text-sm" />
          <div className="flex gap-2"><button onClick={salvar} className="h-10 rounded-lg bg-primary px-5 text-sm text-primary-foreground">Salvar</button><button onClick={() => setAcao(null)} className="h-10 px-4 text-sm">Cancelar</button></div>
        </section>
      )}

      <nav className="flex gap-1 border-b border-border">
        {([["resumo", "Resumo"], ["titulos", "Títulos e parcelas"], ["linha", "Linha do tempo"], ["promessas", "Negociações e promessas"], ["agenda", "Agenda"], ["dados", "Dados cadastrais"]] as const).map(([k, r]) => (
          <button key={k} onClick={() => setAba(k)} className={`border-b-2 px-4 py-2 text-sm ${aba === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>{r}</button>
        ))}
      </nav>

      {aba === "resumo" && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card r="Total em aberto" v={brl(vencido + aVencer)} />
          <Card r="Total vencido" v={brl(vencido)} alerta={vencido > 0} />
          <Card r="A vencer" v={brl(aVencer)} />
          <Card r="Parcelas vencidas" v={String(vencidas.length)} />
          <Card r="Maior atraso" v={`${Math.max(0, ...vencidas.map((p) => p.atraso))} dias`} />
          <Card r="Recebido no mês (baixas reais)" v={brl(recuperadoMes)} />
          <Card r="Próxima ação" v={prox ? `${dataBR(prox.vence_em)}` : "—"} />
          <Card r="Promessas" v={d.promessas.filter((p) => p.status === "vigente").length + " vigente(s) · " + d.promessas.filter((p) => p.status === "descumprida").length + " descumprida(s)"} />
        </div>
      )}
      {aba === "titulos" && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>{["Título", "Vencimento", "Valor", "Saldo", "Atraso", "Eventos"].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
            <tbody>{d.parcelas.map((p) => (
              <tr key={p.installment_id} className="border-t border-border">
                <td className="px-4 py-3">{p.numero ?? "—"}</td><td className="px-4 py-3">{dataBR(p.vencimento)}</td>
                <td className="px-4 py-3 font-mono">{brl(Number(p.valor_cents))}</td><td className="px-4 py-3 font-mono">{brl(Number(p.saldo_cents))}</td>
                <td className={`px-4 py-3 ${p.atraso > 0 ? "text-destructive" : ""}`}>{p.atraso} dias</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{d.interacoes.filter((i) => i.installment_ids.includes(p.installment_id)).length} interação(ões) · {d.recebimentos.filter((r) => r.installment_id === p.installment_id).length} baixa(s)</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {aba === "linha" && (
        <ol className="space-y-2">
          {[
            ...d.interacoes.map((i) => ({ k: i.id, t: i.created_at, auto: false, txt: `${ROTULO_TIPO[i.tipo] ?? i.tipo}${i.resultado ? ` · ${i.resultado}` : ""}`, obs: i.observacao, autor: i.autor })),
            ...d.recebimentos.map((r, n) => ({ k: "r" + n, t: r.data, auto: true, txt: `${r.estorno ? "Estorno" : "Recebimento"} ${brl(Number(r.valor_cents))}`, obs: null, autor: "Financeiro" })),
          ].sort((a, b) => b.t.localeCompare(a.t)).map((e) => (
            <li key={e.k} className={`rounded-lg border p-3 text-sm ${e.auto ? "border-accent bg-accent/30" : "border-border bg-card"}`}>
              <div className="flex justify-between"><b>{e.txt}</b><span className="text-xs text-muted-foreground">{e.auto ? "Automático · " : ""}{e.autor ?? "—"} · {dataBR(e.t)}</span></div>
              {e.obs && <p className="mt-1 text-muted-foreground">{e.obs}</p>}
            </li>
          ))}
        </ol>
      )}
      {aba === "promessas" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Promessa não é recebimento. A situação é avaliada pelas baixas reais nas parcelas.</p>
          {d.promessas.length === 0 ? <p className="text-sm text-muted-foreground">Sem promessas.</p> : d.promessas.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-sm">
              <span><b className="font-mono">{brl(Number(p.valor_cents))}</b> para {dataBR(p.data_prometida)} · {p.installment_ids.length} parcela(s) · <span className={p.status === "descumprida" ? "text-destructive" : ""}>{ROTULO_PROMESSA[p.status]}</span>{p.cancel_motivo && ` (${p.cancel_motivo})`}</span>
              {p.status === "vigente" && <button className="text-xs underline" onClick={async () => { const m = prompt("Motivo do cancelamento"); if (m) { await cancelarPromessa(p.id, m); recarregar(); } }}>Cancelar</button>}
            </div>
          ))}
        </div>
      )}
      {aba === "agenda" && (
        <div className="space-y-2">{d.tarefas.length === 0 ? <p className="text-sm text-muted-foreground">Sem tarefas.</p> : d.tarefas.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-sm">
            <span>{dataBR(t.vence_em)} · {t.titulo} <span className="text-xs text-muted-foreground">({t.origem === "regua" ? "régua" : t.origem}) · {t.status}{t.motivo_fim && ` — ${t.motivo_fim}`}</span></span>
            {t.status === "aberta" && <button className="text-xs underline" onClick={async () => { await concluirTarefa(t.id); recarregar(); }}>Concluir</button>}
          </div>))}</div>
      )}
      {aba === "dados" && (
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          {d.contatos.length === 0 ? <p className="text-muted-foreground">Sem contatos cadastrados.</p> : d.contatos.map((c, i) => <p key={i}>{c.tipo}: {c.valor}</p>)}
          <p className="mt-3 text-xs text-muted-foreground">Etapa atual: {rotuloEtapa(d.caso?.etapa ?? "novo_atraso")}</p>
        </div>
      )}
    </div>
  );
}
