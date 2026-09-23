import * as React from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { EmptyState, Panel, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import {
  AVISO_SIMULACAO,
  FASES,
  PreparacaoNaoAplicada,
  carregarFila,
  carregarOcorrencias,
  carregarParcelas,
  situacaoCobranca,
  type ContaAsaas,
  type Cursor,
  type LinhaReceber,
  type SituacaoFiltro,
} from "@/lib/asaas-painel";
import { estadoContasAsaas, gerarLinkCobranca, obterLinkDaCobranca, recuperarIntencao } from "@/lib/asaas/cobranca.functions";
import { demoEvento, demoPerderResposta } from "@/lib/asaas/demo.functions";
import { AsaasImportacao } from "./AsaasImportacao";

type Resultado = { state?: string; reaproveitada?: boolean; fase?: string | null; erro?: string | null; chamadas_criar?: number; aviso?: string; next_attempt_at?: string | null };

function DetalheParcela({ conta, linha, demo, onFechar }: { conta: ContaAsaas; linha: LinhaReceber; demo: boolean; onFechar: () => void }) {
  const qc = useQueryClient();
  const gerar = useServerFn(gerarLinkCobranca);
  const perder = useServerFn(demoPerderResposta);
  const recuperar = useServerFn(recuperarIntencao);
  const obterLink = useServerFn(obterLinkDaCobranca);
  const evento = useServerFn(demoEvento);
  const [forma, setForma] = React.useState<"PIX" | "BOLETO">("PIX");
  const [ultimo, setUltimo] = React.useState<string | null>(null);
  const [urlObtida, setUrlObtida] = React.useState<string | null>(null);
  const atualizar = () => void qc.invalidateQueries({ queryKey: ["asaas"] });
  const falhou = (e: Error) => toast.error(e.message);
  const descrever = (r: Resultado) =>
    `Situação: ${r.state}${r.reaproveitada ? " (existente reaproveitada)" : ""}${r.fase ? ` — ${FASES[r.fase] ?? r.fase}` : ""}${r.aviso ? ` — ${r.aviso}` : ""}${r.next_attempt_at ? ` (próxima tentativa: ${new Date(r.next_attempt_at).toLocaleString("pt-BR")})` : ""}`;

  const solicitar = useMutation({
    mutationFn: async (perderResposta: boolean): Promise<Resultado> => {
      const d = { installmentId: linha.installment_id, billingType: forma };
      return perderResposta
        ? perder({ data: { ...d, accountId: conta.id } })
        : gerar({ data: d });
    },
    onSuccess: (r) => { setUltimo(descrever(r)); atualizar(); },
    onError: falhou,
  });
  const recuperarM = useMutation({
    mutationFn: (): Promise<Resultado> => recuperar({ data: { intentId: linha.intencao!.id } }),
    onSuccess: (r) => { setUltimo(`Consulta ao provedor antes de qualquer reenvio. ${descrever(r)}`); atualizar(); },
    onError: falhou,
  });
  const linkM = useMutation({
    mutationFn: () => obterLink({ data: { chargeId: linha.cobranca!.id } }),
    onSuccess: (r) => { setUrlObtida(r.invoice_url); setUltimo(r.consultado ? "Link consultado no provedor pelo identificador; nenhuma cobrança criada." : "Link já estava guardado."); atualizar(); },
    onError: falhou,
  });
  const eventoM = useMutation({
    mutationFn: (repetir: boolean) => evento({ data: { accountId: conta.id, chargeExternalId: linha.cobranca!.external_id!, pagoCents: linha.saldo_cents, tarifaCents: 199, repetir } }),
    onSuccess: (r) => {
      const partes = (r as { repetido?: boolean; efeito?: string; revisao_manual?: boolean }[]).map((e) =>
        e.repetido ? "repetido (sem novo efeito)" : `${e.efeito ?? "registrado"}${e.revisao_manual ? " · revisão manual" : ""}`,
      );
      setUltimo(`Evento: ${partes.join(" / ")}. Nenhuma baixa foi criada.`);
      atualizar();
    },
    onError: falhou,
  });
  const ocupado = solicitar.isPending || recuperarM.isPending || eventoM.isPending || linkM.isPending;
  const estado = linha.intencao?.state;
  const url = linha.cobranca?.invoice_url ?? urlObtida;
  const simulado = conta.situacao === "simulada";
  const op = conta.operacoes;

  return (
    <Panel title="Detalhe da parcela e vínculo Asaas">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-ledger-muted">Devedor</dt><dd className="font-medium">{linha.pessoa ?? "—"}</dd></div>
        <div><dt className="text-ledger-muted">Saldo no servidor</dt><dd className="font-medium tabular-nums" data-testid="saldo-parcela">{formatBRLFromCents(linha.saldo_cents)}</dd></div>
        <div><dt className="text-ledger-muted">Cobrança vinculada</dt><dd className="font-medium break-all" data-testid="cobranca-vinculada">{linha.cobranca?.external_id ?? "nenhuma"}</dd></div>
        <div><dt className="text-ledger-muted">Situação</dt><dd className="font-medium" data-testid="situacao">{situacaoCobranca(linha).rotulo}</dd></div>
      </dl>
      {linha.intencao?.erro && <p className="mt-3 text-sm text-ledger-muted">{linha.intencao.erro}</p>}

      {url && (
        <div className="mt-5 rounded-lg border border-warning px-4 py-3">
          {simulado && <p className="text-sm font-semibold text-warning">{AVISO_SIMULACAO}</p>}
          <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-bronze underline" data-testid="link-fatura">
            {simulado ? "Abrir demonstração local" : "Abrir fatura"}
          </a>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1" role="group" aria-label="Forma de pagamento">
          {(["PIX", "BOLETO"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setForma(f)} aria-pressed={forma === f}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${forma === f ? "border-bronze text-bronze" : "border-line text-ledger-muted"}`}>
              {f === "PIX" ? "Pix" : "Boleto"}
            </button>
          ))}
        </div>
        <button type="button" disabled={!op.cobrar || linha.saldo_cents <= 0 || ocupado || estado === "conciliacao" || estado === "desconhecida" || estado === "aguardando_retentativa"} onClick={() => solicitar.mutate(false)}
          className="rounded-lg border border-bronze px-4 py-2 text-sm font-semibold text-bronze disabled:opacity-50">
          {linha.cobranca ? "Solicitar de novo (reaproveita)" : simulado ? "Solicitar cobrança simulada" : "Solicitar cobrança"}
        </button>
        {demo && !linha.cobranca && !linha.intencao && (
          <button type="button" disabled={ocupado} onClick={() => solicitar.mutate(true)}
            className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ledger-muted">
            Simular resposta perdida
          </button>
        )}
        {(estado === "desconhecida" || estado === "processando" || estado === "preparada" || estado === "aguardando_retentativa") && (
          <button type="button" disabled={!op.recuperar || ocupado} onClick={() => recuperarM.mutate()}
            className="rounded-lg border border-danger px-4 py-2 text-sm font-semibold text-danger">
            Consultar provedor e recuperar
          </button>
        )}
        {linha.cobranca && !url && (
          <button type="button" disabled={!op.link || ocupado} onClick={() => linkM.mutate()}
            className="rounded-lg border border-bronze px-3 py-2 text-xs font-semibold text-bronze">
            Obter link pelo identificador
          </button>
        )}
        {demo && linha.cobranca?.external_id && (
          <>
            <button type="button" disabled={ocupado} onClick={() => eventoM.mutate(false)}
              className="rounded-lg border border-line px-3 py-2 text-xs font-semibold">Simular recebimento (evento)</button>
            <button type="button" disabled={ocupado} onClick={() => eventoM.mutate(true)}
              className="rounded-lg border border-line px-3 py-2 text-xs font-semibold">Evento repetido</button>
          </>
        )}
      </div>
      {!op.cobrar && <p className="mt-3 text-sm text-warning" data-testid="motivo-indisponivel">Operações desta conta indisponíveis: {conta.motivo}</p>}
      {estado === "conciliacao" && <p className="mt-3 text-sm text-danger">Em conciliação: nenhuma nova cobrança pode ser gerada para esta parcela até a revisão.</p>}
      <AvisosPermanentes />
      {ultimo && <p className="mt-3 text-sm font-medium" data-testid="ultimo-resultado">{ultimo}</p>}

      <button type="button" className="mt-5 text-sm text-ledger-muted underline" onClick={onFechar}>Fechar detalhe</button>
    </Panel>
  );
}

const ABAS = [
  { id: "recebiveis", label: "Contas a receber" },
  { id: "importacao", label: "Prévia de importação" },
  { id: "ocorrencias", label: "Ocorrências e conciliação" },
  { id: "erros", label: "Fila de erros" },
] as const;
type Aba = (typeof ABAS)[number]["id"];

const SITUACOES: { value: SituacaoFiltro; label: string }[] = [
  { value: "", label: "Todas as situações" },
  { value: "sem_cobranca", label: "Sem cobrança" },
  { value: "com_link", label: "Com link" },
  { value: "pendente_link", label: "Cobrança sem link" },
  { value: "em_processamento", label: "Em processamento" },
  { value: "conciliacao", label: "Em conciliação" },
  { value: "desconhecida", label: "Resultado desconhecido" },
  { value: "rejeitada", label: "Rejeitada" },
];

function AvisosPermanentes() {
  return (
    <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-ledger-muted">
      <li>Gerar cobrança não liquida a parcela.</li>
      <li>Link de cobrança não comprova pagamento.</li>
      <li>Cobrança não comprova venda e não emite nota fiscal.</li>
      <li>Eventos recebidos continuam aguardando conciliação.</li>
      <li>{AVISO_SIMULACAO.charAt(0) + AVISO_SIMULACAO.slice(1).toLowerCase()}: simulação não é cobrança pagável.</li>
    </ul>
  );
}

const TOM_SITUACAO: Record<ContaAsaas["situacao"], "success" | "warning" | "danger" | "info" | "neutral"> = {
  simulada: "info", sandbox_configurado: "success", preparada: "warning", saida_desligada: "warning",
  credencial_ausente: "danger", conta_suspensa: "danger", indisponivel: "danger",
};

function Avisos({ conta }: { conta: ContaAsaas | undefined }) {
  if (!conta) return null;
  return (
    <div className="space-y-1" data-testid="estado-conta">
      <StatusBadge tone={TOM_SITUACAO[conta.situacao]}>{conta.rotulo}</StatusBadge>
      {!conta.operacoes.cobrar && <p className="text-sm text-ledger-muted">{conta.motivo}</p>}
      <AvisosPermanentes />
    </div>
  );
}

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = React.useState(v);
  React.useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

function Mais({ tem, carregando, onClick }: { tem: boolean; carregando: boolean; onClick: () => void }) {
  if (!tem) return null;
  return (
    <div className="px-6 py-4">
      <button type="button" onClick={onClick} disabled={carregando} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-bronze disabled:opacity-50">
        {carregando ? "Carregando…" : "Carregar mais"}
      </button>
    </div>
  );
}

export function AsaasReceber() {
  const [aba, setAba] = React.useState<Aba>("recebiveis");
  const [escolhida, setEscolhida] = React.useState<LinhaReceber | null>(null);
  const [busca, setBusca] = React.useState("");
  const [situacao, setSituacao] = React.useState<SituacaoFiltro>("");
  const [contaSelecionada, setContaSelecionada] = React.useState<string>("");
  const termo = useDebounced(busca);
  const estado = useServerFn(estadoContasAsaas);

  const contas = useQuery({ queryKey: ["asaas", "contas"], queryFn: () => estado() as Promise<ContaAsaas[]>, retry: false });
  const parcelas = useInfiniteQuery({
    queryKey: ["asaas", "parcelas", contaSelecionada, termo, situacao],
    queryFn: ({ pageParam }) => carregarParcelas({ accountId: contaSelecionada, busca: termo, situacao, cursor: pageParam }),
    initialPageParam: null as Cursor,
    getNextPageParam: (p) => p.proximo ?? undefined,
    retry: false,
  });
  const fila = useInfiniteQuery({
    queryKey: ["asaas", "fila", contaSelecionada],
    queryFn: ({ pageParam }) => carregarFila(contaSelecionada, pageParam),
    initialPageParam: null as Cursor,
    getNextPageParam: (p) => p.proximo ?? undefined,
    enabled: aba === "erros",
    retry: false,
  });
  const ocorr = useInfiniteQuery({
    queryKey: ["asaas", "ocorrencias", contaSelecionada],
    queryFn: ({ pageParam }) => carregarOcorrencias(contaSelecionada, pageParam),
    initialPageParam: null as Cursor,
    getNextPageParam: (p) => p.proximo ?? undefined,
    enabled: aba === "ocorrencias",
    retry: false,
  });

  if (contas.error instanceof PreparacaoNaoAplicada || parcelas.error instanceof PreparacaoNaoAplicada) {
    return (
      <div className="space-y-6">
        <Panel title="Recebíveis Asaas">
          <EmptyState
            title="Preparação ainda não aplicada a este ambiente"
            description="As rotinas de importação e de cobrança existem apenas no pacote preparado e no ambiente isolado de testes. Nada foi aplicado ao banco em uso."
          />
        </Panel>
      </div>
    );
  }

  React.useEffect(() => {
    if (!contaSelecionada && contas.data?.[0]) setContaSelecionada(contas.data[0].id);
  }, [contaSelecionada, contas.data]);
  const conta = contas.data?.find((c) => c.id === contaSelecionada) ?? contas.data?.[0];
  const linhas = parcelas.data?.pages.flatMap((p) => p.itens) ?? [];
  const total = parcelas.data?.pages[0]?.total ?? 0;
  const demo = conta?.situacao === "simulada";
  // a linha pode sair do filtro depois de uma ação (ex.: ganhou link); o detalhe continua aberto
  const parcela = escolhida ? (linhas.find((l) => l.installment_id === escolhida.installment_id) ?? escolhida) : null;

  return (
    <div className="space-y-6">
      {(contas.data?.length ?? 0) > 1 && (
        <div className="max-w-md text-sm font-medium">
          <span className="mb-1 block">Conta Asaas</span>
          <SmartSelect
            options={contas.data!.map((c) => ({ value: c.id, label: `${c.nome} — ${c.rotulo}` }))}
            value={conta?.id ?? ""}
            onChange={(v) => { setContaSelecionada(v); setEscolhida(null); }}
            placeholder="Conta Asaas"
          />
        </div>
      )}
      <Avisos conta={conta} />

      <nav className="flex flex-wrap gap-2" aria-label="Seções de recebíveis Asaas">
        {ABAS.map((a) => (
          <button key={a.id} type="button" onClick={() => setAba(a.id)} aria-current={aba === a.id ? "page" : undefined}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${aba === a.id ? "border-bronze text-bronze" : "border-line text-ledger-muted hover:border-bronze"}`}>
            {a.label}
          </button>
        ))}
      </nav>

      {aba === "recebiveis" && (
        <Panel title="Parcelas a receber e situação da cobrança" flush>
          <div className="flex flex-wrap items-center gap-3 px-6 pt-5">
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por pessoa, número ou descrição do título"
              aria-label="Buscar parcelas"
              className="min-w-[16rem] flex-1 rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
            />
            <SmartSelect
              options={SITUACOES}
              value={situacao}
              onChange={(v) => setSituacao(v as SituacaoFiltro)}
              placeholder="Situação"
              className="min-w-[14rem]"
            />
            <span className="text-xs text-ledger-muted" data-testid="contagem-parcelas">
              {parcelas.isFetching ? "Buscando…" : `${linhas.length} de ${total} parcela(s)`}
            </span>
          </div>
          {parcelas.isLoading ? (
            <p className="px-6 py-5 text-sm text-ledger-muted">Carregando…</p>
          ) : linhas.length === 0 ? (
            <div className="px-6 py-5">
              <EmptyState title="Sem parcelas" description={termo || situacao ? "Nenhuma parcela para esta busca." : "Nenhuma parcela a receber."} />
            </div>
          ) : (
            <div className="mt-4 min-w-0 overflow-x-auto">
              <table className="w-full min-w-[54rem] text-sm">
                <thead className="text-left text-ledger-muted">
                  <tr className="border-b border-line-soft">
                    <th className="px-6 py-3 font-semibold">Devedor</th>
                    <th className="px-4 py-3 font-semibold">Vencimento</th>
                    <th className="px-4 py-3 text-right font-semibold">Saldo</th>
                    <th className="px-4 py-3 font-semibold">Cobrança</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => {
                    const s = situacaoCobranca(l);
                    return (
                      <tr key={l.installment_id} className="border-b border-line-soft last:border-0">
                        <td className="px-6 py-3">
                          <span className="font-medium text-ledger-text">{l.pessoa ?? "Sem pessoa vinculada"}</span>
                          <span className="block text-xs text-ledger-muted">{l.descricao ?? l.numero ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3">{new Date(`${l.vencimento}T12:00:00`).toLocaleDateString("pt-BR")}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatBRLFromCents(l.saldo_cents)}</td>
                        <td className="px-4 py-3"><StatusBadge tone={s.tom}>{s.rotulo}</StatusBadge></td>
                        <td className="px-6 py-3 text-right">
                          <button type="button" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:border-bronze hover:text-bronze" onClick={() => setEscolhida(l)}>
                            Detalhe
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Mais tem={Boolean(parcelas.hasNextPage)} carregando={parcelas.isFetchingNextPage} onClick={() => void parcelas.fetchNextPage()} />
        </Panel>
      )}

      {aba === "importacao" && <AsaasImportacao contaId={conta?.id} podeImportar={conta?.operacoes.importar ?? false} motivo={conta?.motivo ?? ""} />}

      {aba === "ocorrencias" && (
        <Panel title="Ocorrências recebidas do provedor">
          {(ocorr.data?.pages.flatMap((p) => p.itens) ?? []).length === 0 ? (
            <EmptyState title="Sem ocorrências na fila" description="Nenhum evento aguardando conciliação." />
          ) : (
            <ul className="space-y-2 text-sm">
              {ocorr.data!.pages.flatMap((p) => p.itens).map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-4 py-3">
                  <span className="font-medium">{o.event}</span>
                  <span className="text-ledger-muted">{o.cobranca ?? "—"}</span>
                  <StatusBadge tone={o.classificacao === "conhecido" ? "info" : "warning"}>{o.classificacao}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
          <Mais tem={Boolean(ocorr.hasNextPage)} carregando={ocorr.isFetchingNextPage} onClick={() => void ocorr.fetchNextPage()} />
        </Panel>
      )}

      {aba === "erros" && (
        <Panel title="Fila de erros e resultados desconhecidos">
          {(fila.data?.pages.flatMap((p) => p.itens) ?? []).length === 0 ? (
            <EmptyState title="Fila vazia" description="Nenhuma tentativa rejeitada ou inconclusiva." />
          ) : (
            <ul className="space-y-2 text-sm">
              {fila.data!.pages.flatMap((p) => p.itens).map((f) => (
                <li key={f.id} className="rounded-lg border border-line px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge tone={f.state === "aguardando_retentativa" ? "warning" : "danger"}>{f.pendencia_operacional ? "Pendência operacional: credencial" : f.state}</StatusBadge>
                    <span className="text-xs text-ledger-muted">{f.attempts} tentativa(s)</span>
                  </div>
                  <p className="mt-2 text-ledger-muted">
                    {f.fase ? `${FASES[f.fase] ?? f.fase}. ` : ""}
                    {f.erro ?? "Resultado desconhecido: consultar o provedor antes de reenviar."}
                  </p>
                  {f.next_attempt_at && <p className="mt-1 text-xs text-ledger-muted">Nova tentativa, na mesma intenção, a partir de {new Date(f.next_attempt_at).toLocaleString("pt-BR")}.</p>}
                </li>
              ))}
            </ul>
          )}
          <Mais tem={Boolean(fila.hasNextPage)} carregando={fila.isFetchingNextPage} onClick={() => void fila.fetchNextPage()} />
        </Panel>
      )}

      {parcela && (() => {
        const real = contas.data?.find((c) => c.id === parcela.account_id) ?? conta;
        return real ? <DetalheParcela conta={real} linha={parcela} demo={real.situacao === "simulada"} onFechar={() => setEscolhida(null)} /> : null;
      })()}
    </div>
  );
}
