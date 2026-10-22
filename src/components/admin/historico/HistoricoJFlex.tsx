/**
 * Tela de importação do histórico SmallData (só Master). Os CSV têm nome, CPF e
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
  categoriaTipoDefinir,
  categoriaTipoLista,
  type TipoMeta,
  importarArquivoHistorico,
  pendenciasVinculo,
  resumoHistorico,
  vincularConsultoraManual,
  vincularHistorico,
  type ProgressoImportacao,
} from "@/lib/historico-jflex";
import { ajustarCadastros, revisaoCadastros } from "@/lib/historico-bi";
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
      const { data, error } = await supabase.rpc("list_parties", { _search: termo.trim(), _limit: 20, _offset: 0 });
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
  const selecionados = ARQUIVOS_HISTORICO.filter((a) => arquivos[a.tipo]);
  const comErro = selecionados.filter((a) => arquivos[a.tipo]!.erro || arquivos[a.tipo]!.linhas === 0);
  // Primeira carga: todos os arquivos. Depois: pode reenviar só os escolhidos (ex.: acertos_consultora.csv).
  const jaImportado = Number((resumo.data as { arquivos?: Record<string, number> } | undefined)?.arquivos?.["maletas"] ?? 0) > 0;
  const podeImportar = ehMaster && !executando && selecionados.length > 0 && comErro.length === 0 && (jaImportado || faltando.length === 0);

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
          <Cartao rotulo="Numeração" valor={`Última SmallData ${rs.numeracao?.ultima_remessa_jflex ?? "—"} · próxima Lardan ${rs.numeracao?.proxima_remessa_lardan ?? "—"}`} destaque={(rs.numeracao?.conflitos?.length ?? 0) > 0} />
          <Cartao rotulo="Conflitos de numeração" valor={(rs.numeracao?.conflitos?.length ?? 0) > 0 ? rs.numeracao!.conflitos.join(", ") : "Nenhum"} destaque={(rs.numeracao?.conflitos?.length ?? 0) > 0} />
          <Cartao rotulo="Última NF por série" valor={Object.entries(rs.fiscal?.ultima_nf_por_serie ?? {}).map(([serie, n]) => `Série ${serie}: ${formatInt(n)}`).join(" · ") || "Sem dados"} />
          <Cartao rotulo="Números de NF repetidos" valor={formatInt(rs.fiscal?.numeros_repetidos ?? 0)} destaque={(rs.fiscal?.numeros_repetidos ?? 0) > 0} />
        </div>
      )}

      <Panel title="Importação dos arquivos do SmallData" flush>
        <div className="px-6 py-5">
          <label className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
            <span className="admin-btn admin-btn-primary">
              <FileUp aria-hidden className="size-4" /> Escolher os CSV
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
              {jaImportado
                ? `O histórico já foi importado: você pode enviar só os arquivos escolhidos (${selecionados.length} escolhido(s)).`
                : `A primeira importação precisa dos ${ARQUIVOS_HISTORICO.length} arquivos. ${faltando.length} pendente(s).`}
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
      {ehMaster && <RevisaoCadastros />}
      <CategoriasTipo ehMaster={ehMaster} />
    </div>
  );
}

const TIPOS_PECA: { value: TipoMeta; label: string }[] = [
  { value: "brinco", label: "Brinco" },
  { value: "anel", label: "Anel" },
  { value: "colar", label: "Colar" },
  { value: "pulseira", label: "Pulseira" },
  { value: "tornozeleira", label: "Tornozeleira" },
  { value: "outro", label: "Outros" },
];

function CategoriasTipo({ ehMaster }: { ehMaster: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["historico-jflex", "categoria-tipo"], queryFn: categoriaTipoLista });
  const definir = useMutation({
    mutationFn: (v: { categoria: string; tipo: TipoMeta }) => categoriaTipoDefinir(v.categoria, v.tipo),
    onSuccess: () => {
      toast.success("Tipo de peça atualizado.");
      void qc.invalidateQueries({ queryKey: ["historico-jflex", "categoria-tipo"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível gravar."),
  });
  return (
    <Panel title="Categorias → tipo de peça" flush>
      <p className="px-6 pt-4 text-sm text-ledger-muted">
        Define em qual cartão da bipagem (Brincos, Anéis, Colares…) cada categoria do SmallData entra nas metas. Categoria sem ajuste conta como "Outros".
      </p>
      {q.isLoading && <div className="space-y-2 p-6"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
      {q.isError && <div className="px-6 py-4"><ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /></div>}
      {q.data?.length === 0 && <div className="px-6 py-5"><EmptyState title="Sem dados" description="Nenhuma categoria encontrada." /></div>}
      {q.data && q.data.length > 0 && (
        <div className="overflow-x-auto pb-2">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
              <tr>
                <th className="px-6 py-3">Categoria do SmallData</th>
                <th className="px-6 py-3">Situação</th>
                <th className="px-6 py-3">Tipo de peça</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((c) => (
                <tr key={c.categoria} className={`border-b border-line-soft last:border-0 ${c.mapeada ? "" : "bg-warning/10"}`}>
                  <td className="px-6 py-3 font-medium text-ledger-text">{c.categoria.trim() || "(sem categoria no SmallData)"}</td>
                  <td className="px-6 py-3">
                    {c.mapeada ? <StatusBadge tone="success">Ajustada</StatusBadge> : <StatusBadge tone="warning">Sem ajuste</StatusBadge>}
                  </td>
                  <td className="px-6 py-3 w-56">
                    {ehMaster ? (
                      <SmartSelect
                        options={TIPOS_PECA}
                        value={c.tipo}
                        disabled={definir.isPending}
                        onChange={(v) => definir.mutate({ categoria: c.categoria, tipo: v as TipoMeta })}
                      />
                    ) : (
                      <span>{TIPOS_PECA.find((t) => t.value === c.tipo)?.label ?? c.tipo}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/**
 * Cadastros criados a partir do histórico (rotina de 22/10): confere situação,
 * praça e possíveis duplicadas por nome. O ajuste só mexe em quem ainda não
 * tem nenhuma operação no Lardan (maleta, título, pedido ou login). Só Master.
 */
function RevisaoCadastros() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["historico-jflex", "revisao-cadastros"], queryFn: revisaoCadastros });
  const previa = useQuery({ queryKey: ["historico-jflex", "ajuste-previa"], queryFn: () => ajustarCadastros(false) });
  const aplicar = useMutation({
    mutationFn: () => ajustarCadastros(true),
    onSuccess: (r) => {
      toast.success(`${formatInt(r.inativadas)} cadastro(s) inativado(s) e ${formatInt(r.praca_definida)} com praça definida.`);
      void qc.invalidateQueries({ queryKey: ["historico-jflex"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível ajustar."),
  });
  const r = q.data;
  const pv = previa.data;
  return (
    <Panel title="Cadastros criados a partir do histórico" flush>
      {q.isLoading && <div className="space-y-2 p-6"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
      {q.isError && <div className="px-6 py-4"><ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /></div>}
      {r && (
        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Cartao rotulo="Criados pelo histórico" valor={`${formatInt(r.criadas)} · ativos ${formatInt(r.ativas)}`} />
            <Cartao rotulo="Ativos que estavam inativos no SmallData" valor={formatInt(r.deveriam_estar_inativas)} destaque={r.deveriam_estar_inativas > 0} />
            <Cartao rotulo="Sem praça" valor={`${formatInt(r.sem_praca)} · praça conhecida para ${formatInt(r.praca_disponivel)}`} destaque={r.praca_disponivel > 0} />
            <Cartao rotulo="Possíveis duplicadas (mesmo nome)" valor={formatInt(r.possiveis_duplicadas)} destaque={r.possiveis_duplicadas > 0} />
          </div>
          {pv && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft px-4 py-3 text-sm">
              <p className="text-ledger-text">
                Ajuste proposto: inativar {formatInt(pv.inativadas)} e definir a praça de {formatInt(pv.praca_definida)}, entre {formatInt(pv.cadastros_sem_operacao)} cadastros
                ainda sem operação no Lardan. Quem já tem maleta, título, pedido ou login não é tocado.
              </p>
              <button
                type="button"
                className="admin-btn admin-btn-primary"
                disabled={aplicar.isPending || (pv.inativadas === 0 && pv.praca_definida === 0)}
                onClick={() => aplicar.mutate()}
              >
                {aplicar.isPending ? "Ajustando…" : "Aplicar ajuste"}
              </button>
            </div>
          )}
          {r.duplicadas.length > 0 && (
            <div className="overflow-x-auto">
              <p className="mb-2 text-sm text-ledger-muted">
                Mesmo nome de um cadastro que já existia. Confira e, se for a mesma pessoa, use a unificação de cadastros (a prévia mostra o que move).
              </p>
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
                  <tr>
                    <th className="px-4 py-2.5">Criado pelo histórico</th>
                    <th className="px-4 py-2.5">Código SmallData</th>
                    <th className="px-4 py-2.5">Cadastro que já existia</th>
                    <th className="px-4 py-2.5">CPF dele</th>
                  </tr>
                </thead>
                <tbody>
                  {r.duplicadas.map((d) => (
                    <tr key={`${d.criada}-${d.outra}`} className="border-b border-line-soft last:border-0">
                      <td className="px-4 py-2.5"><a className="admin-link" href={`/admin/cadastros/pessoas/${d.criada}`}>{d.display_name}</a></td>
                      <td className="px-4 py-2.5 tabular-nums">{d.codcli}</td>
                      <td className="px-4 py-2.5"><a className="admin-link" href={`/admin/cadastros/pessoas/${d.outra}`}>{d.outra_nome}</a></td>
                      <td className="px-4 py-2.5 tabular-nums text-ledger-muted">{d.outra_cpf ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
