/**
 * Tela de importação do histórico JFLEX (só Master). Os CSV têm nome, CPF e
 * endereço: ficam só na memória do navegador, sem log e sem repositório.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, FileUp, Link2, Search } from "lucide-react";
import { EmptyState, ErrorState, Panel, Skeleton, StatusBadge, formatBRLFromCents, formatInt } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { ARQUIVOS_HISTORICO, conferirColunas, lerCsv } from "@/lib/historico-jflex-csv";
import {
  importarArquivoHistorico,
  pendenciasVinculo,
  resumoHistorico,
  vincularConsultoraManual,
  vincularHistorico,
  type ProgressoImportacao,
} from "@/lib/historico-jflex";
import { supabase } from "@/integrations/supabase/client";

const brl = formatBRLFromCents;

type ArquivoSelecionado = { texto: string; linhas: number; erro: string | null };
type RelatorioVinculo = {
  consultoras: { total: number; por_codigo: number; por_cpf: number; manual: number; sem_cadastro: number; sem_cadastro_com_maleta: number; cpf_ambiguo: number };
  representantes: { total: number; vinculados: number };
  pracas: { total: number; vinculadas: number };
  produtos: { total: number; vinculados: number };
};
type Resumo = {
  arquivos: Record<string, number>;
  vinculo: { consultoras_vinculadas: number; consultoras_com_maleta_sem_cadastro: number };
  periodo: { de: string; ate: string } | null;
  numeracao: { ultima_remessa_jflex: number | null; ultima_remessa_lardan: number | null; proxima_remessa_lardan: number; conflitos: number[] };
  fiscal: { ultima_nf_por_serie: Record<string, number>; numeros_repetidos: number };
  totais: { pecas_enviadas: number; pecas_vendidas: number; valor_vendido_cents: number; giro_pct: number | null };
};

function loteAtual() {
  return `jflex-${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(/[-: ]/g, "").slice(0, 12)}`;
}

function Cartao({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl border border-line-soft bg-surface p-4">
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className={`mt-1 font-display text-xl font-semibold tabular-nums ${destaque ? "text-danger" : "text-ledger-text"}`}>{valor}</p>
    </div>
  );
}

function Barra({ texto, valor, total }: { texto: string; valor: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((valor / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-ledger-text">{texto}</span>
        <span className="tabular-nums text-ledger-muted">{formatInt(valor)} / {formatInt(total)} linhas</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
        <div className="h-full rounded-full bg-bronze transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BuscaPessoa({ onEscolher }: { onEscolher: (partyId: string) => void }) {
  const [texto, setTexto] = React.useState("");
  const [termo, setTermo] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setTermo(texto), 300);
    return () => clearTimeout(t);
  }, [texto]);
  const opcoes = useQuery({
    queryKey: ["historico-jflex", "pessoas", termo],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_parties", { _search: termo.trim() || undefined, _limit: 20, _offset: 0 });
      if (error) throw error;
      return ((data ?? []) as unknown as { id: string; display_name: string; code?: string | null }[]).map((p) => ({
        value: p.id,
        label: `${p.display_name}${p.code ? ` · ${p.code}` : ""}`,
      }));
    },
    enabled: termo.trim().length >= 2,
  });
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="ledger-eyebrow">Ligar a uma pessoa do cadastro</span>
      <span className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ledger-muted" />
        <input className="admin-input w-full pl-9" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar pessoa pelo nome ou código" />
      </span>
      {termo.trim().length >= 2 && (
        <SmartSelect
          value=""
          onChange={(v) => {
            if (v) onEscolher(v);
          }}
          options={opcoes.data ?? []}
          loading={opcoes.isFetching}
          placeholder={opcoes.data?.length ? "Escolher pessoa" : "Nenhuma pessoa encontrada"}
        />
      )}
    </label>
  );
}

function Pendencias() {
  const qc = useQueryClient();
  const [texto, setTexto] = React.useState("");
  const [busca, setBusca] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setBusca(texto), 300);
    return () => clearTimeout(t);
  }, [texto]);
  const q = useQuery({ queryKey: ["historico-jflex", "pendencias", busca], queryFn: () => pendenciasVinculo(busca, 200) });
  const ligar = useMutation({
    mutationFn: async (v: { codcli: number; party: string | null }) => vincularConsultoraManual(v.codcli, v.party),
    onSuccess: (_, v) => {
      toast.success(v.party ? "Consultora ligada ao cadastro." : "Vínculo desfeito.");
      void qc.invalidateQueries({ queryKey: ["historico-jflex"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível gravar o vínculo."),
  });

  return (
    <Panel title="Consultoras sem cadastro no sistema" flush>
      <div className="px-6 pt-4">
        <label className="grid gap-1.5 text-sm">
          <span className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ledger-muted" />
            <input className="admin-input w-full pl-9" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar pelo nome" />
          </span>
        </label>
      </div>
      {q.isLoading && <div className="space-y-2 p-6"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
      {q.isError && <div className="px-6 py-4"><ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /></div>}
      {q.data?.length === 0 && (
        <div className="px-6 py-5"><EmptyState title="Nenhuma pendência" description="Toda consultora com maleta já está ligada a um cadastro." /></div>
      )}
      {q.data && q.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
              <tr>
                <th className="px-6 py-3">Nome</th>
                <th className="px-6 py-3">Cidade / UF</th>
                <th className="px-6 py-3">CPF</th>
                <th className="px-6 py-3 text-right">Maletas</th>
                <th className="px-6 py-3">Última maleta</th>
                <th className="px-6 py-3">Vínculo</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.codcli} className="border-b border-line-soft last:border-0 align-top">
                  <td className="px-6 py-3 font-medium text-ledger-text">{p.nome ?? `Código ${p.codcli}`}</td>
                  <td className="px-6 py-3 text-ledger-muted">{[p.cidade, p.uf].filter(Boolean).join("/") || "—"}</td>
                  <td className="px-6 py-3 text-ledger-muted">
                    {p.cpf_mascarado ?? "—"}
                    {p.pessoas_com_mesmo_cpf > 1 && (
                      <span className="ml-2 rounded-lg border border-warning px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-warning">
                        CPF em {p.pessoas_com_mesmo_cpf} cadastros
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums">{p.maletas}</td>
                  <td className="px-6 py-3 text-ledger-muted">{p.ultima_maleta ? p.ultima_maleta.slice(0, 10).split("-").reverse().join("/") : "—"}</td>
                  <td className="px-6 py-3">
                    <BuscaPessoa onEscolher={(partyId) => ligar.mutate({ codcli: p.codcli, party: partyId })} />
                    {p.ativo && (
                      <button type="button" className="admin-link mt-1 block text-xs" disabled={ligar.isPending} onClick={() => ligar.mutate({ codcli: p.codcli, party: null })}>
                        Desfazer vínculo
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-6 py-4 text-xs text-ledger-muted">
        Nenhuma tela cria pessoa a partir do histórico. O vínculo manual fica registrado na auditoria e pode ser desfeito.
      </p>
    </Panel>
  );
}

export function HistoricoJFlexImportacao({ ehMaster }: { ehMaster: boolean }) {
  const qc = useQueryClient();
  const [arquivos, setArquivos] = React.useState<Record<string, ArquivoSelecionado>>({});
  const [prog, setProg] = React.useState<ProgressoImportacao | null>(null);
  const [prontos, setProntos] = React.useState<string[]>([]);
  const [executando, setExecutando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [relatorio, setRelatorio] = React.useState<RelatorioVinculo | null>(null);

  const resumo = useQuery({ queryKey: ["historico-jflex", "resumo"], queryFn: resumoHistorico });

  const ler = async (lista: FileList) => {
    const novos: Record<string, ArquivoSelecionado> = {};
    for (const f of Array.from(lista)) {
      const def = ARQUIVOS_HISTORICO.find((a) => a.arquivo.toLowerCase() === f.name.toLowerCase());
      if (!def) {
        novos[f.name] = { texto: "", linhas: 0, erro: `Arquivo não faz parte do pacote (esperados: ${ARQUIVOS_HISTORICO.map((a) => a.arquivo).join(", ")})` };
        continue;
      }
      const texto = await f.text();
      const linhas = lerCsv(texto);
      novos[def.tipo] = { texto, linhas: linhas.length, erro: conferirColunas(def.tipo, linhas) };
    }
    setArquivos((a) => ({ ...a, ...novos }));
    setProntos([]);
    setErro(null);
    setRelatorio(null);
  };

  const faltando = ARQUIVOS_HISTORICO.filter((a) => !arquivos[a.tipo] || arquivos[a.tipo]!.erro || arquivos[a.tipo]!.linhas === 0);
  const podeImportar = ehMaster && !executando && faltando.length === 0;

  const executar = async () => {
    setExecutando(true);
    setErro(null);
    setRelatorio(null);
    setProntos([]);
    const lote = loteAtual();
    try {
      for (const a of ARQUIVOS_HISTORICO) {
        const f = arquivos[a.tipo];
        if (!f) continue;
        setProg({ tipo: a.tipo, enviadas: 0, total: f.linhas });
        await importarArquivoHistorico(a.tipo, f.texto, lote, setProg);
        setProntos((p) => [...p, a.tipo]);
      }
      const rel = await vincularHistorico(true);
      setRelatorio(rel as unknown as RelatorioVinculo);
      toast.success("Importação concluída. Vínculo automático executado.");
      void qc.invalidateQueries({ queryKey: ["historico-jflex"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha na importação.";
      setErro(msg);
      toast.error(msg);
    } finally {
      setExecutando(false);
      setProg(null);
    }
  };

  const rs = resumo.data as Resumo | undefined;

  return (
    <div className="space-y-8">
      {resumo.isLoading && <Skeleton className="h-40 w-full" />}
      {resumo.isError && <ErrorState message={(resumo.error as Error).message} onRetry={() => void resumo.refetch()} />}
      {rs && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Cartao rotulo="Registros importados" valor={formatInt(rs.arquivos?.["maletas"] ?? 0) + " maletas"} />
          <Cartao rotulo="Período" valor={[rs.periodo?.de, rs.periodo?.ate].filter(Boolean).map((v) => (v as string).slice(0, 10).split("-").reverse().join("/")).join(" · ") || "Sem dados"} />
          <Cartao rotulo="Peças enviadas · vendidas" valor={`${formatInt(rs.totais?.pecas_enviadas ?? 0)} · ${formatInt(rs.totais?.pecas_vendidas ?? 0)}`} />
          <Cartao rotulo="Valor vendido" valor={brl(rs.totais?.valor_vendido_cents ?? 0)} />
          <Cartao rotulo="Giro" valor={rs.totais?.giro_pct != null ? `${rs.totais.giro_pct}%` : "Sem dados"} />
          <Cartao rotulo="Consultoras ligadas" valor={`${rs.vinculo?.consultoras_vinculadas ?? 0} · sem cadastro: ${rs.vinculo?.consultoras_com_maleta_sem_cadastro ?? 0}`} />
          <Cartao rotulo="Numeração" valor={`Última JFLEX ${rs.numeracao?.ultima_remessa_jflex ?? "—"} · próxima Lardan ${rs.numeracao?.proxima_remessa_lardan ?? "—"}`} destaque={(rs.numeracao?.conflitos?.length ?? 0) > 0} />
          <Cartao rotulo="Conflitos de numeração" valor={(rs.numeracao?.conflitos?.length ?? 0) > 0 ? rs.numeracao!.conflitos.join(", ") : "Nenhum"} destaque={(rs.numeracao?.conflitos?.length ?? 0) > 0} />
          <Cartao rotulo="Última NF por série" valor={Object.entries(rs.fiscal?.ultima_nf_por_serie ?? {}).map(([serie, n]) => `Série ${serie}: ${formatInt(n)}`).join(" · ") || "Sem dados"} />
          <Cartao rotulo="Números de NF repetidos" valor={formatInt(rs.fiscal?.numeros_repetidos ?? 0)} destaque={(rs.fiscal?.numeros_repetidos ?? 0) > 0} />
        </div>
      )}

      <Panel title="Importação dos arquivos do JFLEX" flush>
        <div className="px-6 py-5">
          <label className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
            <span className="admin-btn admin-btn-primary">
              <FileUp aria-hidden className="size-4" /> Escolher os 10 CSV
            </span>
            <input type="file" accept=".csv,text/csv" multiple className="sr-only" onChange={(e) => { if (e.target.files?.length) void ler(e.target.files); e.target.value = ""; }} />
            <span className="text-ledger-muted">
              Os arquivos têm nome, CPF e endereço: ficam só na memória deste navegador, sem log e sem cópia. Reimportar é seguro — o banco atualiza, não duplica.
            </span>
          </label>

          <div className="mt-5 grid gap-2 md:grid-cols-2">
            {ARQUIVOS_HISTORICO.map((a) => {
              const f = arquivos[a.tipo];
              const ok = f && !f.erro && f.linhas > 0;
              return (
                <div key={a.tipo} className="flex items-center justify-between gap-3 rounded-xl border border-line-soft bg-surface px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ledger-text">{a.rotulo}</p>
                    <p className="text-xs text-ledger-muted">{a.arquivo}</p>
                  </div>
                  {ok ? (
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success">
                      <CheckCircle2 aria-hidden className="size-4" /> {formatInt(f.linhas)} linhas
                    </span>
                  ) : f?.erro ? (
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-warning"><CircleAlert aria-hidden className="size-4" /> {f.erro}</span>
                  ) : (
                    <span className="text-sm text-ledger-muted">faltando</span>
                  )}
                </div>
              );
            })}
          </div>

          {prog && (
            <div className="mt-5">
              <Barra texto={ARQUIVOS_HISTORICO.find((a) => a.tipo === prog.tipo)?.rotulo ?? prog.tipo} valor={prog.enviadas} total={prog.total} />
            </div>
          )}

          {faltando.length > 0 && !executando && (
            <p className="mt-4 text-sm font-medium text-ledger-muted">
              Importação fica disponível com os 10 arquivos reconhecidos. {faltando.length} pendente(s).
            </p>
          )}
          {!ehMaster && <p className="mt-4 text-sm font-medium text-warning">Só o Master importa. Seu perfil pode ler o histórico, mas não envia arquivos.</p>}

          <div className="mt-5">
            <button type="button" className="admin-btn admin-btn-primary" disabled={!podeImportar} onClick={() => void executar()}>
              {executando ? "Importando…" : "Importar"}
            </button>
          </div>

          {erro && (
            <div role="alert" className="mt-4 rounded-xl border border-danger bg-surface p-4 text-sm font-medium text-danger">
              Importação parada: {erro} Os arquivos anteriores já enviados estão no banco; corrija e reimportar é seguro.
            </div>
          )}
        </div>
      </Panel>

      {relatorio && (
        <Panel title="Relatório de vínculo automático" flush>
          <div className="grid gap-3 p-6 sm:grid-cols-2 xl:grid-cols-4">
            <Cartao rotulo="Consultoras" valor={`${relatorio.consultoras.total} · código ${relatorio.consultoras.por_codigo} · CPF ${relatorio.consultoras.por_cpf} · manual ${relatorio.consultoras.manual}`} />
            <Cartao rotulo="Sem cadastro" valor={`${relatorio.consultoras.sem_cadastro} (${relatorio.consultoras.sem_cadastro_com_maleta} com maleta)`} destaque={relatorio.consultoras.sem_cadastro_com_maleta > 0} />
            <Cartao rotulo="CPF ambíguo" valor={`${relatorio.consultoras.cpf_ambiguo}`} destaque={relatorio.consultoras.cpf_ambiguo > 0} />
            <Cartao rotulo="Representantes · praças · produtos" valor={`${relatorio.representantes.vinculados}/${relatorio.representantes.total} · ${relatorio.pracas.vinculadas}/${relatorio.pracas.total} · ${relatorio.produtos.vinculados}/${relatorio.produtos.total}`} />
          </div>
        </Panel>
      )}

      <Pendencias />
    </div>
  );
}
