import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gavel, Upload, AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { lerPlanilhaJuridico, type LinhaJuridico } from "@/lib/planilha-juridico";
import { brl, dataBR } from "@/lib/cobranca";

type Previa = { lote: string | null; linhas: number; com_pessoa: number; sem_pessoa: number; ambiguos: number; novos: number; atualizados: number; mover_judicial: number; ja_judicial: number; sem_lista: { id: string; nome: string; cpf: string | null; motivo: string }[] };

const DIAS_PROTOCOLO = 5;

export function ProcessosJudiciais() {
  const qc = useQueryClient();
  const qm = useQuery({ queryKey: ["eu-master"], queryFn: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return false;
    const { data } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "master" });
    return !!data;
  } });
  const master = !!qm.data;
  const [linhas, setLinhas] = React.useState<LinhaJuridico[] | null>(null);
  const [previa, setPrevia] = React.useState<Previa | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [termo, setTermo] = React.useState("");
  const arq = React.useRef<HTMLInputElement>(null);

  const q = useQuery({
    queryKey: ["cob", "jud-processos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cob_judicial_processos")
        .select("id,party_id,nome,cpf,numero_processo,status,valor_causa_cents,fase,cidade,responsavel,proxima_acao,link_pasta,ultima_atualizacao,created_at")
        .order("nome").limit(3000);
      if (error) throw error;
      return data;
    },
  });

  const rodar = async (aplicar: boolean, l = linhas) => {
    if (!l) return;
    setOcupado(true);
    try {
      const { data, error } = await supabase.rpc("cob_judicial_planilha_importar", { _linhas: l as never, _aplicar: aplicar });
      if (error) throw error;
      setPrevia(data as unknown as Previa);
      if (aplicar) { toast.success("Planilha aplicada."); qc.invalidateQueries({ queryKey: ["cob"] }); setLinhas(null); }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível ler."); } finally { setOcupado(false); }
  };

  const escolher = async (f: File) => {
    try { const l = lerPlanilhaJuridico(await f.arrayBuffer()); setLinhas(l); await rodar(false, l); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Planilha inválida."); }
  };

  const hoje = Date.now();
  const lista = (q.data ?? []).filter((p) => !termo || termo.toLowerCase().split(/\s+/).every((t) => [p.nome, p.cpf, p.numero_processo, p.cidade, p.fase].some((x) => x?.toLowerCase().includes(t))));
  const pendentes = (q.data ?? []).filter((p) => /pendente/i.test(p.status ?? ""));
  const atrasoProtocolo = pendentes.filter((p) => hoje - new Date(p.created_at).getTime() > DIAS_PROTOCOLO * 86400000);
  const ativos = (q.data ?? []).filter((p) => !/extint/i.test(p.status ?? ""));

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-display text-xl"><Gavel className="size-5 text-bronze" />Planilha do jurídico</h3>
          <input ref={arq} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void escolher(f); e.target.value = ""; }} />
          <Button variant="outline" disabled={ocupado} onClick={() => arq.current?.click()}><Upload className="size-4" />Ler planilha (.xlsx)</Button>
        </div>
        <p className="text-sm text-muted-foreground">A leitura mostra uma prévia e não muda nada. Só o Master aplica. Pessoas são achadas pelo CPF; CPF repetido em dois cadastros fica de fora. Nada no financeiro é alterado.</p>
        {previa && (
          <div className="space-y-3 rounded-xl border border-border p-4">
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <Num r="Linhas" v={previa.linhas} /><Num r="Achadas pelo CPF" v={previa.com_pessoa} /><Num r="Sem cadastro" v={previa.sem_pessoa} alerta={previa.sem_pessoa > 0} /><Num r="CPF em 2 cadastros" v={previa.ambiguos} />
              <Num r="Processos novos" v={previa.novos} /><Num r="Processos atualizados" v={previa.atualizados} /><Num r="Vão para Judicial" v={previa.mover_judicial} /><Num r="Já estavam em Judicial" v={previa.ja_judicial} />
            </div>
            {previa.lote ? <p className="text-sm font-medium text-primary">Aplicado. Lote {previa.lote.slice(0, 8)}.</p> : (
              <div className="flex gap-2">
                <Button disabled={ocupado || !master} onClick={() => rodar(true)}>{master ? "Aplicar planilha" : "Só o Master aplica"}</Button>
                <Button variant="ghost" onClick={() => { setPrevia(null); setLinhas(null); }}>Descartar</Button>
              </div>
            )}
            {previa.sem_lista.length > 0 && (
              <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Ver {previa.sem_lista.length} sem cadastro (processo é guardado mesmo assim)</summary>
                <ul className="mt-2 max-h-64 space-y-1 overflow-auto">{previa.sem_lista.map((s, i) => <li key={i}>#{s.id} · {s.nome || "sem nome"} · {s.cpf ?? "—"} · <span className="text-muted-foreground">{s.motivo}</span></li>)}</ul>
              </details>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Num r="Processos" v={q.data?.length ?? 0} /><Num r="Em andamento" v={ativos.length} /><Num r="Pendentes de protocolo" v={pendentes.length} />
          <Num r={`Sem protocolo há +${DIAS_PROTOCOLO} dias`} v={atrasoProtocolo.length} alerta={atrasoProtocolo.length > 0} />
        </div>
        {atrasoProtocolo.length > 0 && <p className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="size-4" />{atrasoProtocolo.length} processo(s) aguardando protocolo há mais de {DIAS_PROTOCOLO} dias: {atrasoProtocolo.slice(0, 5).map((p) => p.nome).join(", ")}</p>}
        <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar por nome, CPF, processo, cidade ou fase" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" />
        {q.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : lista.length === 0 ? <p className="text-sm text-muted-foreground">Sem dados.</p> : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2">Executada</th><th className="p-2">Processo</th><th className="p-2">Situação</th><th className="p-2 text-right">Causa</th><th className="p-2">Fase</th><th className="p-2">Atualizado</th><th /></tr></thead>
              <tbody>{lista.slice(0, 300).map((p) => (
                <tr key={p.id} className="border-t border-border align-top">
                  <td className="p-2"><p className="font-medium">{p.nome}</p><p className="text-xs text-muted-foreground">{p.cidade}{!p.party_id && " · sem cadastro"}</p></td>
                  <td className="p-2 font-mono text-xs">{p.numero_processo ?? "—"}</td>
                  <td className="p-2">{p.status}</td>
                  <td className="p-2 text-right tabular-nums">{p.valor_causa_cents != null ? brl(Number(p.valor_causa_cents)) : "—"}</td>
                  <td className="max-w-xs p-2 text-xs">{p.fase}</td>
                  <td className="p-2 text-xs">{p.ultima_atualizacao ? dataBR(p.ultima_atualizacao) : "—"}</td>
                  <td className="p-2">{p.link_pasta && <a href={p.link_pasta} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-primary">Pasta<ExternalLink className="size-3" /></a>}</td>
                </tr>))}</tbody>
            </table>
            {lista.length > 300 && <p className="p-2 text-xs text-muted-foreground">Mostrando 300 de {lista.length}. Refine a busca.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function Num({ r, v, alerta }: { r: string; v: number; alerta?: boolean }) {
  return <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">{r}</p><p className={`mt-1 font-mono text-xl tabular-nums ${alerta ? "text-destructive" : ""}`}>{v}</p></div>;
}
