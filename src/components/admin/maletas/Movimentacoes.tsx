import * as React from "react";
import { FotoPeca } from "@/components/FotoPeca";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState, ErrorState, Panel, Skeleton, StatusBadge, formatDateTime } from "@/components/admin/ui";
import { VariantPicker, type VariantOption } from "@/components/admin/VariantPicker";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { comReferencia, useReferencias } from "@/lib/referencias-pecas";
import {
  DESTINO_RETORNO,
  TIPO_MOVIMENTO,
  type DestinoRetorno,
  type Movimento,
  acrescentarPecas,
  chaveIdempotencia,
  conciliacaoMaleta,
  conferirRetorno,
  confirmarAcrescimo,
  declararRetorno,
  depositosAtivos,
  historicoMaleta,
  traduzir,
} from "@/lib/maletas";

type Nomes = Record<string, string>;

const num = (v: unknown) => Math.max(0, Number(v ?? 0));

/** Conferência por produto + histórico + as quatro operações do ciclo. */
export function Movimentacoes({
  cycleId,
  nomes,
  podeGerir,
}: {
  cycleId: string;
  nomes: Nomes;
  podeGerir: boolean;
}) {
  const qc = useQueryClient();
  const recarregar = () => qc.invalidateQueries({ queryKey: ["maletas"] });

  const hist = useQuery({ queryKey: ["maletas", "historico", cycleId], queryFn: () => historicoMaleta(cycleId) });
  const conc = useQuery({ queryKey: ["maletas", "conciliacao", cycleId], queryFn: () => conciliacaoMaleta(cycleId) });

  const nome = (id: string) => nomes[id] ?? "Peça";

  return (
    <div className="space-y-6">
      <Conferencia estado={conc} nome={nome} />
      <AcoesRetorno cycleId={cycleId} nome={nome} podeGerir={podeGerir} onFeito={recarregar} />
      <Historico estado={hist} nome={nome} onFeito={recarregar} />
    </div>
  );
}

/* ---------------- conferência ---------------- */

function Conferencia({
  estado,
  nome,
}: {
  estado: ReturnType<typeof useQuery<Awaited<ReturnType<typeof conciliacaoMaleta>>>>;
  nome: (id: string) => string;
}) {
  if (estado.isLoading) return <Skeleton className="h-40" />;
  if (estado.isError)
    return (
      <Panel title="Conferência">
        <ErrorState message={traduzir(estado.error)} onRetry={() => void estado.refetch()} />
      </Panel>
    );
  const d = estado.data!;
  const t = d.totais;

  const colunas: { chave: keyof typeof t; rotulo: string }[] = [
    { chave: "enviado", rotulo: "Remessa inicial" },
    { chave: "a_caminho", rotulo: "Remessa em trânsito" },
    { chave: "aceito", rotulo: "Recebidas pela consultora" },
    { chave: "acrescido_transito", rotulo: "Acréscimo em trânsito" },
    { chave: "acrescido", rotulo: "Acréscimo recebido" },
    { chave: "retorno_em_transito", rotulo: "Retorno declarado" },
    { chave: "retornado", rotulo: "Retorno aprovado" },
    { chave: "divergencia", rotulo: "Divergência" },
    { chave: "garantia", rotulo: "Garantia / defeito" },
    { chave: "mantida", rotulo: "Mantidas" },
    { chave: "perda", rotulo: "Perdas" },
    { chave: "vendido", rotulo: "Vendas comprovadas" },
  ];

  return (
    <Panel title="Conferência por peça">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {colunas.map((c) => (
          <div key={c.chave} className="rounded-xl border border-line-soft px-4 py-3">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-ledger-muted">{c.rotulo}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-ledger-text">{num(t[c.chave])}</p>
          </div>
        ))}
        <div className="rounded-xl border border-warning/60 bg-surface-muted px-4 py-3">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-warning">
            Ainda sob responsabilidade
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-ledger-text">{num(t.a_explicar)}</p>
        </div>
      </div>

      <p className="mt-4 rounded-xl border border-line-soft bg-surface-muted px-4 py-3 text-sm leading-relaxed text-ledger-muted">
        {d.linhas.length === 0 ? (
          <>
            Este ciclo ainda não tem saldos por peça registrados: os números acima ficam zerados até a maleta ser
            recebida e movimentada. Isso <strong className="text-ledger-text">não significa divergência</strong>.
          </>
        ) : (
          <>
            As {num(t.a_explicar)} peças acima continuam sob responsabilidade de quem está com a maleta. Elas{" "}
            <strong className="text-ledger-text">não comprovam venda</strong> e não geram cobrança.
            {d.vendas_disponiveis
              ? ""
              : " As vendas da consultora ainda não alimentam esta conferência, então o destino delas precisa ser informado manualmente."}
          </>
        )}
      </p>

      {d.linhas.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ledger-muted">
                <th className="py-2 pr-4 font-semibold">Peça</th>
                {colunas.map((c) => (
                  <th key={c.chave} className="px-2 py-2 text-right font-semibold">
                    {c.rotulo}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-semibold">A explicar</th>
              </tr>
            </thead>
            <tbody>
              {d.linhas.map((l) => (
                <tr key={l.variant_id} className="border-b border-line-soft last:border-0">
                  <td className="py-2 pr-4 font-medium text-ledger-text"><span className="flex items-center gap-2"><FotoPeca variantId={l.variant_id} size="xs" />{nome(l.variant_id)}</span></td>
                  {colunas.map((c) => (
                    <td key={c.chave} className="px-2 py-2 text-right tabular-nums text-ledger-muted">
                      {num(l[c.chave as keyof typeof l])}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{num(l.a_explicar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ---------------- peças extras (acréscimo) ---------------- */

type LinhaExtra = { peca: VariantOption; qtd: number };
const chaveLista = (cycleId: string) => `lardan:acrescimo:${cycleId}`;

/**
 * 0343 — "Peças extras do ciclo": fica no topo da maleta, perto de Correios e Identificação.
 * Lista exclusiva de todo acréscimo já gravado (a caminho / recebido) + formulário para enviar mais.
 * A lista ainda não enviada fica guardada nesta aba do navegador: sair da tela não apaga nada.
 */
export function PecasExtras({
  cycleId,
  nomes,
  podeAcrescentar,
  emOperacao,
}: {
  cycleId: string;
  nomes: Nomes;
  podeAcrescentar: boolean;
  emOperacao: boolean;
}) {
  const qc = useQueryClient();
  const recarregar = () => qc.invalidateQueries({ queryKey: ["maletas"] });
  const hist = useQuery({ queryKey: ["maletas", "historico", cycleId], queryFn: () => historicoMaleta(cycleId) });
  const extras = (hist.data?.movimentos ?? []).filter((m) => m.tipo === "acrescimo" && m.situacao !== "cancelado");
  const varIds = extras.flatMap((m) => m.itens.map((i) => i.variant_id));
  const refs = useReferencias(varIds);
  const nome = (id: string) => nomes[id] ?? comReferencia(refs.data?.get(id), "Peça extra");
  const total = extras.reduce((s, m) => s + m.itens.reduce((t, i) => t + i.quantidade, 0), 0);
  const aCaminho = extras.filter((m) => m.situacao === "pendente").reduce((s, m) => s + m.itens.reduce((t, i) => t + i.quantidade, 0), 0);

  if (!podeAcrescentar && extras.length === 0) return null;

  return (
    <Panel title="Peças extras do ciclo">
      <div className="space-y-4">
        {hist.isLoading ? (
          <Skeleton className="h-16" />
        ) : extras.length === 0 ? (
          <p className="text-sm text-ledger-muted">Nenhuma peça extra enviada para esta maleta.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ledger-text">
              <strong className="tabular-nums">{total}</strong> peça(s) extra(s) neste ciclo
              {aCaminho > 0 ? <span className="text-warning"> · {aCaminho} a caminho, falta confirmar o recebimento</span> : null}
            </p>
            {extras.map((m) => (
              <ExtraEnviado key={m.id} m={m} nome={nome} onFeito={recarregar} />
            ))}
          </div>
        )}
        {podeAcrescentar && emOperacao && <FormAcrescimo cycleId={cycleId} onFeito={recarregar} />}
        {podeAcrescentar && !emOperacao && (
          <p className="text-xs text-ledger-muted">Dá para acrescentar peças depois que a maleta é expedida e enquanto está com a consultora.</p>
        )}
      </div>
    </Panel>
  );
}

function ExtraEnviado({ m, nome, onFeito }: { m: Movimento; nome: (id: string) => string; onFeito: () => void }) {
  const confirmar = useMutation({
    mutationFn: () => confirmarAcrescimo(m.id),
    onSuccess: (r) => {
      toast.success(r.repetida ? "Recebimento já registrado." : "Recebimento confirmado.");
      onFeito();
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const pendente = m.situacao === "pendente";
  return (
    <div className="rounded-xl border border-line-soft px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={pendente ? "warning" : "success"}>{pendente ? "A caminho" : "Recebida"}</StatusBadge>
        <span className="text-xs text-ledger-muted">
          enviada {formatDateTime(m.quando)}
          {m.confirmado_em ? ` · recebida ${formatDateTime(m.confirmado_em)}` : ""}
        </span>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {m.itens.map((i) => (
          <li key={i.id} className="flex items-center gap-2">
            <FotoPeca variantId={i.variant_id} size="xs" />
            <span className="min-w-0 flex-1 truncate text-ledger-text">{nome(i.variant_id)}</span>
            <span className="tabular-nums text-ledger-muted">{i.quantidade} un</span>
          </li>
        ))}
      </ul>
      {m.observacao ? <p className="mt-1 text-xs text-ledger-muted">{m.observacao}</p> : null}
      {pendente && (
        <button type="button" className="admin-btn mt-2" disabled={confirmar.isPending} onClick={() => confirmar.mutate()}>
          Confirmar recebimento
        </button>
      )}
    </div>
  );
}

function FormAcrescimo({ cycleId, onFeito }: { cycleId: string; onFeito: () => void }) {
  const [linhas, setLinhas] = React.useState<LinhaExtra[]>([]);
  const [carregou, setCarregou] = React.useState(false);
  const [peca, setPeca] = React.useState<VariantOption | null>(null);
  const [qtd, setQtd] = React.useState(1);
  const [origem, setOrigem] = React.useState("");
  const [nota, setNota] = React.useState("");

  // lista ainda não enviada: guardada nesta aba (sair da tela e voltar não perde nada)
  React.useEffect(() => {
    try {
      const salvo = sessionStorage.getItem(chaveLista(cycleId));
      if (salvo) setLinhas(JSON.parse(salvo) as LinhaExtra[]);
    } catch {
      /* lista vazia */
    }
    setCarregou(true);
  }, [cycleId]);
  React.useEffect(() => {
    if (!carregou) return;
    try {
      if (linhas.length) sessionStorage.setItem(chaveLista(cycleId), JSON.stringify(linhas));
      else sessionStorage.removeItem(chaveLista(cycleId));
    } catch {
      /* sem armazenamento: segue só na tela */
    }
  }, [linhas, carregou, cycleId]);
  React.useEffect(() => {
    if (linhas.length === 0) return;
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [linhas.length]);

  const depositos = useQuery({ queryKey: ["maletas", "depositos"], queryFn: depositosAtivos });
  React.useEffect(() => { const p = depositos.data?.find((d) => d.code === "DEP-01"); if (p && !origem) setOrigem(p.id); }, [depositos.data, origem]);

  // A chave vive enquanto o formulário não for concluído: duplo clique, reenvio
  // ou nova tentativa depois de um erro de rede usam a MESMA chave e o banco
  // devolve o movimento já registrado em vez de criar outro.
  const chaveRef = React.useRef(chaveIdempotencia());
  const pecasNaLista = linhas.reduce((s, l) => s + l.qtd, 0);

  const enviar = useMutation({
    mutationFn: () =>
      acrescentarPecas(cycleId, {
        itens: linhas.map((l) => ({ variant_id: l.peca.id, quantity: l.qtd })),
        origem_location_id: origem || null,
        note: nota || undefined,
        idempotency_key: chaveRef.current,
      }),
    onSuccess: (r) => {
      toast.success(
        r.repetida
          ? "Este acréscimo já estava registrado."
          : `${r.quantidade} peça(s) extra(s) gravadas e a caminho. Falta a confirmação de quem recebe.`,
      );
      chaveRef.current = chaveIdempotencia();
      setLinhas([]);
      setNota("");
      onFeito();
    },
    onError: (e) => {
      // nova chave: a próxima tentativa (talvez com outra lista) não colide com a que falhou
      chaveRef.current = chaveIdempotencia();
      toast.error(`Nada foi gravado: ${traduzir(e)}`);
    },
  });

  return (
    <div className="space-y-3 rounded-xl border border-line-soft p-4">
      <p className="text-sm font-semibold text-ledger-text">Acrescentar peças</p>
      <VariantPicker value={peca} onChange={setPeca} />
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          aria-label="Quantidade"
          className="admin-input w-20"
          value={qtd}
          onChange={(e) => setQtd(Math.max(1, Number(e.target.value)))}
        />
        <button
          type="button"
          className="admin-btn flex-1"
          disabled={!peca}
          onClick={() => {
            if (!peca) return;
            setLinhas((v) => [...v.filter((l) => l.peca.id !== peca.id), { peca, qtd }]);
            setPeca(null);
            setQtd(1);
          }}
        >
          Pôr na lista
        </button>
      </div>

      {linhas.length > 0 && (
        <>
          <ul className="space-y-2">
            {linhas.map((l) => (
              <li key={l.peca.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{l.peca.label}</span>
                <span className="tabular-nums">{l.qtd} un</span>
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => setLinhas((v) => v.filter((x) => x.peca.id !== l.peca.id))}
                >
                  Tirar
                </button>
              </li>
            ))}
          </ul>
          <p className="rounded-lg border border-warning/60 bg-surface-muted px-3 py-2 text-xs text-warning">
            {pecasNaLista} peça(s) na lista ainda NÃO foram gravadas. Clique em "Gravar peças extras".
          </p>
        </>
      )}

      <div className="grid gap-2">
        <div className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-ledger-muted">Depósito de origem</span>
          <SmartSelect
            options={(depositos.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
            value={origem}
            onChange={setOrigem}
            placeholder="Depósito de origem da maleta"
          />
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-ledger-muted">Observação</span>
          <input className="admin-input w-full" value={nota} onChange={(e) => setNota(e.target.value)} />
        </label>
      </div>

      <button
        type="button"
        className="admin-btn admin-btn-primary w-full justify-center"
        disabled={linhas.length === 0 || enviar.isPending}
        onClick={() => enviar.mutate()}
      >
        {enviar.isPending ? "Gravando…" : `Gravar peças extras${pecasNaLista ? ` (${pecasNaLista})` : ""}`}
      </button>
      <p className="text-xs text-ledger-muted">
        Funciona mesmo com o estoque ainda não contado. As peças ficam "a caminho" até quem está com a maleta
        confirmar o recebimento.
      </p>
    </div>
  );
}

/* ---------------- declaração de retorno ---------------- */

function AcoesRetorno({
  cycleId,
  nome,
  podeGerir,
  onFeito,
}: {
  cycleId: string;
  nome: (id: string) => string;
  podeGerir: boolean;
  onFeito: () => void;
}) {
  const conc = useQuery({ queryKey: ["maletas", "conciliacao", cycleId], queryFn: () => conciliacaoMaleta(cycleId) });
  const [aberto, setAberto] = React.useState(false);
  const [linhas, setLinhas] = React.useState<Record<string, { qtd: number; destino: DestinoRetorno; motivo: string }>>(
    {},
  );

  const disponiveis = (conc.data?.linhas ?? []).filter((l) => num(l.sob_responsabilidade) > 0);

  // Mesma chave enquanto a declaração não for concluída: reenviar não duplica.
  const chaveRef = React.useRef(chaveIdempotencia());

  const enviar = useMutation({
    mutationFn: () =>
      declararRetorno(cycleId, {
        itens: Object.entries(linhas)
          .filter(([, v]) => v.qtd > 0)
          .map(([variant_id, v]) => ({
            variant_id,
            quantity: v.qtd,
            destino: v.destino,
            reason: v.motivo || undefined,
          })),
        idempotency_key: chaveRef.current,
      }),
    onSuccess: (r) => {
      toast.success(
        r.repetida ? "Este retorno já estava registrado." : `${r.quantidade} peças declaradas. Aguardando a Matriz.`,
      );
      chaveRef.current = chaveIdempotencia();
      setLinhas({});
      setAberto(false);
      onFeito();
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  if (disponiveis.length === 0) return null;

  return (
    <Panel
      title="Declarar retorno"
      action={
        <button type="button" className="admin-btn" onClick={() => setAberto((v) => !v)}>
          {aberto ? "Fechar" : "Abrir"}
        </button>
      }
    >
      {!aberto ? (
        <p className="text-sm text-ledger-muted">
          {podeGerir
            ? "Registre peça a peça o que volta, o que fica, o que vai para garantia e o que se perdeu."
            : "Informe o destino de cada peça que sai da sua responsabilidade."}
        </p>
      ) : (
        <div className="space-y-3">
          {disponiveis.map((l) => {
            const v = linhas[l.variant_id] ?? { qtd: 0, destino: "retorno" as DestinoRetorno, motivo: "" };
            return (
              <div key={l.variant_id} className="flex flex-wrap items-end gap-3 border-b border-line-soft pb-3">
                <div className="min-w-48 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ledger-text"><FotoPeca variantId={l.variant_id} size="xs" />{nome(l.variant_id)}</p>
                  <p className="text-xs text-ledger-muted">{num(l.sob_responsabilidade)} sob responsabilidade</p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={num(l.sob_responsabilidade)}
                  className="admin-input w-24"
                  value={v.qtd}
                  onChange={(e) =>
                    setLinhas((s) => ({
                      ...s,
                      [l.variant_id]: {
                        ...v,
                        qtd: Math.min(num(e.target.value), num(l.sob_responsabilidade)),
                      },
                    }))
                  }
                />
                <select
                  className="admin-input w-56"
                  value={v.destino}
                  onChange={(e) =>
                    setLinhas((s) => ({ ...s, [l.variant_id]: { ...v, destino: e.target.value as DestinoRetorno } }))
                  }
                >
                  {Object.entries(DESTINO_RETORNO).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </select>
                <input
                  className="admin-input w-56"
                  placeholder={v.destino === "perda" ? "Motivo da perda (obrigatório)" : "Motivo (opcional)"}
                  value={v.motivo}
                  onChange={(e) => setLinhas((s) => ({ ...s, [l.variant_id]: { ...v, motivo: e.target.value } }))}
                />
              </div>
            );
          })}
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            disabled={enviar.isPending || !Object.values(linhas).some((v) => v.qtd > 0)}
            onClick={() => enviar.mutate()}
          >
            Registrar declaração
          </button>
          <p className="text-xs text-ledger-muted">
            Nada entra no depósito agora: o retorno fica em trânsito até a conferência na Matriz.
          </p>
        </div>
      )}
    </Panel>
  );
}

/* ---------------- histórico e confirmações ---------------- */

function Historico({
  estado,
  nome,
  onFeito,
}: {
  estado: ReturnType<typeof useQuery<{ movimentos: Movimento[] }>>;
  nome: (id: string) => string;
  onFeito: () => void;
}) {
  if (estado.isLoading) return <Skeleton className="h-40" />;
  if (estado.isError)
    return (
      <Panel title="Movimentações">
        <ErrorState message={traduzir(estado.error)} onRetry={() => void estado.refetch()} />
      </Panel>
    );
  const movs = estado.data?.movimentos ?? [];

  return (
    <Panel title="Movimentações do ciclo" flush>
      {movs.length === 0 ? (
        <div className="px-6">
          <EmptyState
            title="Sem movimentações"
            description="A remessa inicial aparece aqui assim que a maleta for expedida."
          />
        </div>
      ) : (
        movs.map((m) => <LinhaMovimento key={m.id} m={m} nome={nome} onFeito={onFeito} />)
      )}
    </Panel>
  );
}

function LinhaMovimento({ m, nome, onFeito }: { m: Movimento; nome: (id: string) => string; onFeito: () => void }) {
  const [conferindo, setConferindo] = React.useState(false);
  const tom = m.situacao === "confirmado" ? "success" : m.situacao === "cancelado" ? "danger" : "warning";

  const confirmar = useMutation({
    mutationFn: () => confirmarAcrescimo(m.id),
    onSuccess: (r) => {
      toast.success(r.repetida ? "Recebimento já registrado." : "Recebimento confirmado.");
      onFeito();
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  return (
    <div className="space-y-2 border-b border-line-soft px-6 py-4 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-ledger-text">
          #{m.seq} · {TIPO_MOVIMENTO[m.tipo] ?? m.tipo}
        </span>
        <StatusBadge tone={tom}>{m.situacao}</StatusBadge>
        <span className="text-xs text-ledger-muted">
          {formatDateTime(m.quando)}
          {m.confirmado_por ? ` · confirmado por ${m.confirmado_por}` : ""}
        </span>
      </div>

      <ul className="space-y-1 text-xs text-ledger-muted">
        {m.itens.map((i) => (
          <li key={i.id}>
            {nome(i.variant_id)} · {i.quantidade} un
            {i.destino ? ` · ${DESTINO_RETORNO[i.destino] ?? i.destino}` : ""}
            {i.recebida != null ? ` · recebidas ${i.recebida}, aprovadas ${i.aprovada ?? 0}` : ""}
            {i.divergente ? `, divergentes ${i.divergente}` : ""}
            {i.motivo_conferencia ? ` · ${i.motivo_conferencia}` : i.motivo ? ` · ${i.motivo}` : ""}
          </li>
        ))}
      </ul>

      {m.tipo === "acrescimo" && m.situacao === "pendente" && (
        <button type="button" className="admin-btn" disabled={confirmar.isPending} onClick={() => confirmar.mutate()}>
          Confirmar recebimento
        </button>
      )}

      {m.tipo === "retorno" && m.situacao === "pendente" && (
        <>
          <button type="button" className="admin-btn" onClick={() => setConferindo((v) => !v)}>
            {conferindo ? "Fechar conferência" : "Conferir chegada na Matriz"}
          </button>
          {conferindo && <FormConferencia m={m} nome={nome} onFeito={onFeito} />}
        </>
      )}
    </div>
  );
}

function FormConferencia({ m, nome, onFeito }: { m: Movimento; nome: (id: string) => string; onFeito: () => void }) {
  const conferiveis = m.itens.filter((i) => i.destino === "retorno" || i.destino === "garantia");
  const [dados, setDados] = React.useState<Record<string, { rec: number; apr: number; div: number; motivo: string }>>(
    () =>
      Object.fromEntries(
        conferiveis.map((i) => [i.id, { rec: i.quantidade, apr: i.quantidade, div: 0, motivo: "" }]),
      ),
  );
  const [deposito, setDeposito] = React.useState("");
  const depositos = useQuery({ queryKey: ["maletas", "depositos"], queryFn: depositosAtivos });
  React.useEffect(() => { const p = depositos.data?.find((d) => d.code === "DEP-01"); if (p && !deposito) setDeposito(p.id); }, [depositos.data, deposito]);

  const enviar = useMutation({
    mutationFn: () =>
      conferirRetorno(m.id, {
        destino_location_id: deposito || null,
        itens: conferiveis.map((i) => {
          const v = dados[i.id]!;
          return {
            item_id: i.id,
            qty_recebida: v.rec,
            qty_aprovada: v.apr,
            qty_divergente: v.div,
            motivo: v.motivo || undefined,
          };
        }),
      }),
    onSuccess: (r) => {
      toast.success(
        r.repetida
          ? "Este retorno já havia sido conferido."
          : `Conferido: ${r.aprovadas} aprovadas, ${r.divergentes} divergentes, ${r.faltantes} não chegaram.`,
      );
      if (r.aviso) toast.warning(r.aviso);
      onFeito();
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  if (conferiveis.length === 0)
    return (
      <p className="mt-2 text-xs text-ledger-muted">
        Esta declaração não tem peças físicas a conferir (somente mantidas ou perdas).
      </p>
    );

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line-soft p-4">
      {conferiveis.map((i) => {
        const v = dados[i.id]!;
        return (
          <div key={i.id} className="flex flex-wrap items-end gap-3">
            <div className="min-w-44 flex-1">
              <p className="text-sm font-semibold text-ledger-text">{nome(i.variant_id)}</p>
              <p className="text-xs text-ledger-muted">
                declaradas {i.quantidade} · {DESTINO_RETORNO[i.destino!]}
              </p>
            </div>
            <label className="text-xs text-ledger-muted">
              Recebidas
              <input
                type="number"
                min={0}
                max={i.quantidade}
                className="admin-input w-20"
                value={v.rec}
                onChange={(e) =>
                  setDados((s) => ({ ...s, [i.id]: { ...v, rec: Math.min(num(e.target.value), i.quantidade) } }))
                }
              />
            </label>
            <label className="text-xs text-ledger-muted">
              Aprovadas
              <input
                type="number"
                min={0}
                max={v.rec}
                className="admin-input w-20"
                value={v.apr}
                onChange={(e) => setDados((s) => ({ ...s, [i.id]: { ...v, apr: num(e.target.value) } }))}
              />
            </label>
            <label className="text-xs text-ledger-muted">
              Com defeito
              <input
                type="number"
                min={0}
                max={v.rec}
                className="admin-input w-20"
                value={v.div}
                onChange={(e) => setDados((s) => ({ ...s, [i.id]: { ...v, div: num(e.target.value) } }))}
              />
            </label>
            <input
              className="admin-input w-56"
              placeholder="Motivo da diferença"
              value={v.motivo}
              onChange={(e) => setDados((s) => ({ ...s, [i.id]: { ...v, motivo: e.target.value } }))}
            />
          </div>
        );
      })}

      <label className="block text-sm">
        <span className="mb-1 block text-xs font-semibold text-ledger-muted">Depósito que recebe</span>
        <select className="admin-input w-72" value={deposito} onChange={(e) => setDeposito(e.target.value)}>
          <option value="">Depósito de origem da maleta</option>
          {(depositos.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="admin-btn admin-btn-primary"
        disabled={enviar.isPending}
        onClick={() => enviar.mutate()}
      >
        Confirmar conferência
      </button>
      <p className="text-xs text-ledger-muted">
        Peças com defeito e peças em garantia vão para o local bloqueado e ficam fora do estoque disponível.
        O que foi declarado e não chegou continua a explicar — não vira venda nem dívida.
      </p>
    </div>
  );
}
