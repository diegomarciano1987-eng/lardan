import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Brain, Check, ChevronRight, FilePlus2, Link2, Search, SkipForward, Sparkles, UserRound, X } from "lucide-react";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { classificarTitulo, criarTitulo, fetchClassificacoes, fetchFinTitle } from "@/lib/financeiro";
import { centrosMesa, contrapartesMesa, palpiteDaLinha, papeisTexto, tituloDaParcela } from "@/lib/mesa-conciliacao";
import { formatBRLFromCents, Skeleton } from "@/components/admin/ui";
import { reaisParaCentavos } from "@/lib/financeiro";
import { listarParcelas, type ParcelaLinha } from "@/lib/financeiro-parcelas";
import { conciliar, listarLinhasExtrato, marcarLinha, sugerirCorrespondencias, type LinhaExtratoRow } from "@/lib/conciliacao";
import { useCapabilities } from "@/lib/capabilities";

const dataBR = (d: string | null) =>
  d ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${d}T12:00:00`)) : "—";
const centsParaTexto = (c: number) => (c / 100).toFixed(2).replace(".", ",");

type Candidata = {
  installment_id: string;
  titulo: string;
  contraparte: string | null;
  vencimento: string;
  aberto_cents: number;
  score?: number;
  motivos?: string[];
};

function deParcela(p: ParcelaLinha): Candidata {
  return {
    installment_id: p.id,
    titulo: `${p.descricao}${p.total_parcelas > 1 ? ` (${p.numero}/${p.total_parcelas})` : ""}`,
    contraparte: p.contraparte,
    vencimento: p.vencimento,
    aberto_cents: p.saldo_cents,
  };
}

/**
 * Mesa de conciliação em tela cheia: um lançamento do extrato por vez, à esquerda
 * a fila, no centro o lançamento e a bandeja de vínculo, à direita as contas que
 * podem casar com ele (sugestões ou busca livre). Usa as mesmas RPCs da tela clássica.
 */
export function MesaConciliacao({
  conta,
  contaNome,
  de,
  ate,
  onFechar,
  onMudou,
}: {
  conta: string;
  contaNome: string;
  de: string;
  ate: string;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const caps = useCapabilities();
  const podeConciliar = caps.includes("finance.reconcile");
  const podeMarcar = caps.includes("finance.statement.flag");

  const fila = useQuery({
    queryKey: ["mesa-fila", conta, de, ate],
    queryFn: async () => {
      const [p, d] = await Promise.all([
        listarLinhasExtrato({ financial_account_id: conta, status: "pendente", de, ate, limit: 200, offset: 0 }),
        listarLinhasExtrato({ financial_account_id: conta, status: "divergente", de, ate, limit: 100, offset: 0 }),
      ]);
      return [...p.rows, ...d.rows].sort((a, b) => (a.data ?? "").localeCompare(b.data ?? ""));
    },
  });

  const [resolvidas, setResolvidas] = React.useState<string[]>([]);
  const [puladas, setPuladas] = React.useState<string[]>([]);
  const [atualId, setAtualId] = React.useState<string | null>(null);

  const linhasFila = (fila.data ?? []).filter((l) => !resolvidas.includes(l.id));
  const ordenada = [...linhasFila.filter((l) => !puladas.includes(l.id)), ...linhasFila.filter((l) => puladas.includes(l.id))];
  const atual = ordenada.find((l) => l.id === atualId) ?? ordenada[0] ?? null;
  const totalInicial = (fila.data ?? []).length;

  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = "";
    };
  }, [onFechar]);

  const avancar = (id: string, tipo: "resolvida" | "pulada") => {
    if (tipo === "resolvida") setResolvidas((p) => [...p, id]);
    else setPuladas((p) => [...p.filter((x) => x !== id), id]);
    const idx = ordenada.findIndex((l) => l.id === id);
    const prox = ordenada.filter((l) => l.id !== id)[Math.max(0, idx)] ?? null;
    setAtualId(prox?.id ?? null);
  };

  const pct = totalInicial ? Math.round((resolvidas.length / totalInicial) * 100) : 0;

  return (
    <div role="dialog" aria-modal="true" aria-label="Mesa de conciliação" className="fixed inset-0 z-[60] flex flex-col bg-background">
      <header className="flex flex-wrap items-center gap-4 border-b border-line bg-surface px-6 py-4">
        <div className="min-w-0">
          <p className="ledger-eyebrow">Mesa de conciliação · {contaNome}</p>
          <p className="font-display text-xl font-bold text-ledger-text">
            {dataBR(de)} a {dataBR(ate)}
          </p>
        </div>
        <div className="ml-auto flex min-w-[260px] flex-1 items-center gap-3 sm:max-w-md">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-cream-2" aria-label={`Progresso ${pct}%`}>
            <div className="h-full rounded-full bg-bronze transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-ledger-text">
            {resolvidas.length} de {totalInicial}
          </span>
        </div>
        <button type="button" className="admin-btn" onClick={onFechar}>
          <X aria-hidden className="mr-1 inline size-4" /> Fechar mesa
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Fila */}
        <aside className="hidden min-h-0 overflow-y-auto border-r border-line bg-cream-2/50 p-3 lg:block">
          <p className="ledger-eyebrow px-2 pb-2">Fila ({linhasFila.length})</p>
          {fila.isLoading && <Skeleton className="h-40 w-full" />}
          <ul className="space-y-1.5">
            {ordenada.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => setAtualId(l.id)}
                  className={`w-full rounded-[10px] border px-3 py-2 text-left transition ${
                    atual?.id === l.id ? "border-bronze bg-surface shadow-sm" : "border-transparent hover:border-line hover:bg-surface"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-ledger-muted">{dataBR(l.data)}</span>
                    <span className={`text-sm font-semibold tabular-nums ${l.kind === "saida" ? "text-destructive" : "text-ledger-text"}`}>
                      {l.kind === "saida" ? "− " : "+ "}
                      {formatBRLFromCents(l.valor_cents ?? 0)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-ledger-text">{l.historico || "Sem histórico"}</p>
                  {puladas.includes(l.id) && <p className="text-[11px] font-semibold text-bronze">Para depois</p>}
                  {l.status === "divergente" && <p className="text-[11px] font-semibold text-destructive">Divergente</p>}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {atual ? (
          <Bancada
            key={atual.id}
            linha={atual}
            conta={conta}
            podeConciliar={podeConciliar}
            podeMarcar={podeMarcar}
            onFeito={() => {
              onMudou();
              avancar(atual.id, "resolvida");
            }}
            onPular={() => avancar(atual.id, "pulada")}
          />
        ) : (
          <div className="col-span-2 flex flex-col items-center justify-center gap-3 p-10 text-center">
            {fila.isLoading ? (
              <Skeleton className="h-40 w-96" />
            ) : (
              <>
                <Sparkles aria-hidden className="size-12 text-bronze" />
                <p className="font-display text-3xl font-bold text-ledger-text">Tudo conciliado!</p>
                <p className="text-ledger-muted">
                  {resolvidas.length > 0
                    ? `Você resolveu ${resolvidas.length} lançamento(s) nesta sessão.`
                    : "Não há lançamentos pendentes nesta conta e período."}
                </p>
                <button type="button" className="admin-btn-primary mt-2" onClick={onFechar}>
                  Voltar ao extrato
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


const campoCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm text-ledger-text outline-none focus:border-champagne";

function Rotulo({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-[0.7rem] font-semibold tracking-[0.12em] text-bronze uppercase">{children}</span>;
}

function Bancada({
  linha,
  conta,
  podeConciliar,
  podeMarcar,
  onFeito,
  onPular,
}: {
  linha: LinhaExtratoRow;
  conta: string;
  podeConciliar: boolean;
  podeMarcar: boolean;
  onFeito: () => void;
  onPular: () => void;
}) {
  const saida = linha.kind === "saida";
  const direction = saida ? "payable" : "receivable";
  const valorLinha = (linha.valor_cents ?? 0) - linha.conciliado_cents;
  const [modo, setModo] = React.useState<"existente" | "novo" | null>(null);
  const [aba, setAba] = React.useState<"sugestoes" | "buscar">("sugestoes");
  const [busca, setBusca] = React.useState("");
  const [buscaLenta, setBuscaLenta] = React.useState("");
  const [bandeja, setBandeja] = React.useState<{ c: Candidata; texto: string }[]>([]);
  const [tarifa, setTarifa] = React.useState("");
  const [juros, setJuros] = React.useState("");
  const [desconto, setDesconto] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [marcando, setMarcando] = React.useState(false);
  // Classificação (DRE) e dados complementares
  const [party, setParty] = React.useState("");
  const [partyBusca, setPartyBusca] = React.useState("");
  const [centro, setCentro] = React.useState("");
  const [plano, setPlano] = React.useState("");
  const [forma, setForma] = React.useState("");
  const [descricao, setDescricao] = React.useState(linha.historico ?? "");
  const [documento, setDocumento] = React.useState(linha.documento ?? "");
  const [observacao, setObservacao] = React.useState("");
  const [palpiteAplicado, setPalpiteAplicado] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setBuscaLenta(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  const sugestoes = useQuery({ queryKey: ["fin-sugestoes", linha.id], queryFn: () => sugerirCorrespondencias(linha.id) });
  const palpite = useQuery({ queryKey: ["mesa-palpite", linha.id], queryFn: () => palpiteDaLinha(linha.id) });
  const centros = useQuery({ queryKey: ["mesa-centros"], queryFn: centrosMesa, staleTime: 60_000 });
  const classes = useQuery({
    queryKey: ["fin-classificacoes", direction, "", ""],
    queryFn: () => fetchClassificacoes({ direction }),
    staleTime: 60_000,
  });
  const contrapartes = useQuery({
    queryKey: ["mesa-contrapartes", partyBusca],
    queryFn: () => contrapartesMesa(partyBusca),
    enabled: modo === "novo",
  });
  const procura = useQuery({
    queryKey: ["mesa-busca", saida, buscaLenta],
    queryFn: () =>
      listarParcelas({ direction, busca: buscaLenta, situacao: "aberto", limit: 30, offset: 0 }),
    enabled: modo === "existente" && aba === "buscar",
  });

  // Escolha inicial do caminho: com sugestão → "já existe"; sem sugestão → "novo lançamento".
  React.useEffect(() => {
    if (modo !== null || !sugestoes.data) return;
    setModo(sugestoes.data.length > 0 ? "existente" : "novo");
  }, [sugestoes.data, modo]);

  // Aprendizado: preenche com o que foi usado nas vezes anteriores, sem sobrescrever escolha.
  React.useEffect(() => {
    const p = palpite.data;
    if (!p || palpiteAplicado || !p.vezes) return;
    setPalpiteAplicado(true);
    if (p.cost_center_id) setCentro((v) => v || p.cost_center_id!);
    if (p.chart_account_id) setPlano((v) => v || p.chart_account_id!);
    if (p.payment_method_id) setForma((v) => v || p.payment_method_id!);
    if (p.party_id) setParty((v) => v || p.party_id!);
  }, [palpite.data, palpiteAplicado]);

  const centroSel = (centros.data ?? []).find((c) => c.id === centro);
  const partyOpcoes = React.useMemo(() => {
    const lista = (contrapartes.data ?? []).map((c) => ({ value: c.id, label: c.nome, hint: papeisTexto(c.papeis) || c.code }));
    const p = palpite.data;
    if (party && !lista.some((o) => o.value === party) && p?.party_id === party) {
      lista.unshift({ value: party, label: p.party_nome ?? "Contraparte sugerida", hint: "sugerida" });
    }
    return lista;
  }, [contrapartes.data, party, palpite.data]);
  const partySel = (contrapartes.data ?? []).find((c) => c.id === party);

  const somaAloc = bandeja.reduce((t, b) => t + (reaisParaCentavos(b.texto) ?? 0), 0);
  const ajustes = (reaisParaCentavos(tarifa) ?? 0) + (reaisParaCentavos(juros) ?? 0) - (reaisParaCentavos(desconto) ?? 0);
  const falta = valorLinha - somaAloc - ajustes;
  const bateExistente = bandeja.length > 0 && falta === 0;
  const prontoNovo = !!party && descricao.trim().length > 0;
  const pronto = modo === "novo" ? prontoNovo : bateExistente;

  const adicionar = (c: Candidata) => {
    if (bandeja.some((b) => b.c.installment_id === c.installment_id)) {
      setBandeja((p) => p.filter((b) => b.c.installment_id !== c.installment_id));
      return;
    }
    const restante = Math.max(0, valorLinha - somaAloc - ajustes);
    const valor = Math.min(restante || c.aberto_cents, c.aberto_cents);
    setBandeja((p) => [...p, { c, texto: centsParaTexto(valor) }]);
  };

  const aplicar = useMutation({
    mutationFn: async () => {
      const obs = [observacao.trim(), documento.trim() && documento !== linha.documento ? `Doc.: ${documento.trim()}` : ""]
        .filter(Boolean)
        .join(" · ");
      if (modo === "novo") {
        if (!party) throw new Error("Escolha quem recebeu ou pagou.");
        const tituloId = await criarTitulo({
          direction,
          party_id: party,
          descricao: descricao.trim(),
          ...(documento.trim() ? { documento: documento.trim() } : {}),
          ...(linha.data ? { emissao: linha.data, competencia: linha.data } : {}),
          ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
          ...(centro ? { cost_center_id: centro } : {}),
          ...(plano ? { chart_account_id: plano } : {}),
          ...(forma ? { payment_method_id: forma } : {}),
          financial_account_id: conta,
          valor_cents: valorLinha,
          parcelas: [{ vencimento: linha.data ?? new Date().toISOString().slice(0, 10), valor_cents: valorLinha }],
          ...({ origem: "conciliacao", id_externo: `extrato:${linha.id}` } as object),
        });
        const det = await fetchFinTitle(tituloId);
        const inst = det.parcelas[0]?.id;
        if (!inst) throw new Error("Lançamento criado, mas a parcela não foi encontrada.");
        return conciliar({
          line_ids: [linha.id],
          alocacoes: [{ installment_id: inst, valor_cents: valorLinha }],
          ...(obs ? { observacao: obs } : {}),
          idempotency_key: `novo:${linha.id}`,
        });
      }
      const alocacoes = bandeja
        .map((b) => ({ installment_id: b.c.installment_id, valor_cents: reaisParaCentavos(b.texto) ?? 0 }))
        .filter((a) => a.valor_cents > 0);
      if (!alocacoes.length) throw new Error("Escolha ao menos uma conta para vincular.");
      // Classificação para o DRE: só grava o que mudou, sempre com motivo no histórico do título.
      if (centro || plano || forma) {
        const vistos = new Set<string>();
        for (const a of alocacoes) {
          const t = await tituloDaParcela(a.installment_id);
          if (!t || vistos.has(t.title_id)) continue;
          vistos.add(t.title_id);
          const novoCentro = centro || t.cost_center_id;
          const novoPlano = plano || t.chart_account_id;
          const novaForma = forma || t.payment_method_id;
          if (novoCentro === t.cost_center_id && novoPlano === t.chart_account_id && novaForma === t.payment_method_id) continue;
          await classificarTitulo({
            title_id: t.title_id,
            motivo: "Classificado na mesa de conciliação bancária",
            esperado_updated_at: t.updated_at,
            business_entity_id: t.business_entity_id,
            financial_account_id: t.financial_account_id,
            cost_center_id: novoCentro,
            chart_account_id: novoPlano,
            payment_method_id: novaForma,
          });
        }
      }
      return conciliar({
        line_ids: [linha.id],
        alocacoes,
        tarifa_cents: reaisParaCentavos(tarifa) ?? 0,
        juros_cents: reaisParaCentavos(juros) ?? 0,
        desconto_cents: reaisParaCentavos(desconto) ?? 0,
        ...(obs ? { observacao: obs } : {}),
        idempotency_key: `${linha.id}:${JSON.stringify(alocacoes)}`,
      });
    },
    onSuccess: () => {
      toast.success(modo === "novo" ? "Lançamento criado e conciliado!" : "Conciliado! Próximo lançamento.");
      onFeito();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const marcar = useMutation({
    mutationFn: (status: string) => marcarLinha(linha.id, status, motivo.trim()),
    onSuccess: () => {
      toast.success("Situação registrada.");
      onFeito();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && pronto && !aplicar.isPending) aplicar.mutate();
      if (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA") return;
      if (e.key.toLowerCase() === "p") onPular();
      if (e.key === "1") setModo("existente");
      if (e.key === "2") setModo("novo");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [pronto, aplicar, onPular]);

  const candidatas: Candidata[] =
    aba === "sugestoes"
      ? (sugestoes.data ?? []).map((s) => ({
          installment_id: s.installment_id,
          titulo: s.titulo,
          contraparte: s.contraparte,
          vencimento: s.vencimento,
          aberto_cents: s.aberto_cents,
          score: s.score,
          motivos: [
            s.reasons.valor_exato ? "Valor exato" : null,
            s.reasons.dias === 0 ? "Vence no dia" : `${s.reasons.dias} dia(s) do vencimento`,
            s.reasons.documento ? "Documento confere" : null,
            s.reasons.contraparte ? "Nome confere" : null,
          ].filter(Boolean) as string[],
        }))
      : (procura.data?.rows ?? []).map(deParcela);
  const carregando = aba === "sugestoes" ? sugestoes.isLoading : procura.isLoading;

  const pal = palpite.data;
  const opcoesCentro = [
    { value: "", label: "Pendente de classificação" },
    ...(centros.data ?? []).map((c) => ({
      value: c.id,
      label: `${c.codigo} · ${c.nome}`,
      hint: c.responsavel_nome ? `${c.responsavel_nome}${c.papeis.length ? ` (${papeisTexto(c.papeis)})` : ""}` : undefined,
    })),
  ];

  return (
    <>
      {/* Centro: lançamento + escolha do caminho + classificação */}
      <section className="min-h-0 overflow-y-auto border-r border-line p-6">
        <div className="ledger-panel p-6">
          <div className="flex items-center gap-2">
            {saida ? <ArrowUpRight aria-hidden className="size-5 text-destructive" /> : <ArrowDownLeft aria-hidden className="size-5 text-bronze" />}
            <p className="ledger-eyebrow">{saida ? "Saiu da conta" : "Entrou na conta"} · {dataBR(linha.data)}</p>
          </div>
          <p className={`mt-3 font-display text-5xl font-bold tabular-nums ${saida ? "text-destructive" : "text-ledger-text"}`}>
            {formatBRLFromCents(valorLinha)}
          </p>
          <p className="mt-3 text-lg font-semibold text-ledger-text">{linha.historico || "Sem histórico"}</p>
          <p className="mt-1 text-sm text-ledger-muted">
            Linha {linha.line_no}
            {linha.documento ? ` · documento ${linha.documento}` : ""}
            {linha.conciliado_cents > 0 ? ` · já conciliado ${formatBRLFromCents(linha.conciliado_cents)}` : ""}
          </p>
        </div>

        {/* Pergunta principal */}
        <p className="mt-6 mb-2 text-sm font-semibold text-ledger-text">
          Este {saida ? "pagamento" : "recebimento"} já está lançado no sistema?
        </p>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Caminho da conciliação">
          {(
            [
              ["existente", Link2, "Sim, já existe", `Vincular a uma ${saida ? "conta a pagar" : "conta a receber"}`],
              ["novo", FilePlus2, "Não, é novo", "Criar o lançamento agora e conciliar"],
            ] as const
          ).map(([m, Icone, t, d], i) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={modo === m}
              onClick={() => setModo(m)}
              className={`flex items-start gap-3 rounded-[14px] border-2 p-4 text-left transition ${
                modo === m ? "border-bronze bg-surface shadow-md" : "border-line bg-surface hover:border-champagne"
              }`}
            >
              <Icone aria-hidden className={`mt-0.5 size-5 shrink-0 ${modo === m ? "text-bronze" : "text-ledger-muted"}`} />
              <span>
                <span className="block font-semibold text-ledger-text">{t} <span className="text-xs text-ledger-muted">({i + 1})</span></span>
                <span className="block text-xs text-ledger-muted">{d}</span>
              </span>
            </button>
          ))}
        </div>

        {pal && pal.vezes > 0 && (
          <div className="mt-4 flex items-start gap-3 rounded-[14px] border border-champagne/60 bg-cream-2 p-3 text-sm">
            <Brain aria-hidden className="mt-0.5 size-5 shrink-0 text-bronze" />
            <p className="text-ledger-text">
              <strong>Sugestão aprendida:</strong> lançamentos com “{pal.chave}” foram classificados assim em{" "}
              {pal.vezes} conciliação(ões) anterior(es){pal.party_nome ? `, com ${pal.party_nome}` : ""}. Confira antes de gravar.
            </p>
          </div>
        )}

        {modo === "existente" && (
          <div className="mt-6">
            <p className="ledger-eyebrow mb-2">Vínculo</p>
            {bandeja.length === 0 ? (
              <div className="rounded-[14px] border-2 border-dashed border-line p-6 text-center text-sm font-medium text-ledger-muted">
                Clique numa conta ao lado para vincular
              </div>
            ) : (
              <ul className="space-y-2">
                {bandeja.map((b) => (
                  <li key={b.c.installment_id} className="flex items-center gap-3 rounded-[12px] border border-line bg-surface p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ledger-text">{b.c.titulo}</p>
                      <p className="truncate text-xs text-ledger-muted">
                        {b.c.contraparte ?? "Sem nome"} · em aberto {formatBRLFromCents(b.c.aberto_cents)}
                      </p>
                    </div>
                    <input
                      value={b.texto}
                      inputMode="decimal"
                      aria-label="Valor a vincular"
                      onChange={(e) =>
                        setBandeja((p) => p.map((x) => (x.c.installment_id === b.c.installment_id ? { ...x, texto: e.target.value } : x)))
                      }
                      className="h-11 w-32 rounded-[10px] border border-line bg-surface px-3 text-right text-base font-semibold tabular-nums text-ledger-text outline-none focus:border-champagne"
                    />
                    <button type="button" className="admin-btn" aria-label="Tirar do vínculo" onClick={() => adicionar(b.c)}>
                      <X aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-ledger-text">Tarifa, juros ou desconto</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {[
                  ["Tarifa R$", tarifa, setTarifa],
                  ["Juros R$", juros, setJuros],
                  ["Desconto R$", desconto, setDesconto],
                ].map(([rot, v, set]) => (
                  <input
                    key={rot as string}
                    value={v as string}
                    placeholder={rot as string}
                    inputMode="decimal"
                    onChange={(e) => (set as (s: string) => void)(e.target.value)}
                    className={`${campoCls} tabular-nums`}
                  />
                ))}
              </div>
            </details>
          </div>
        )}

        {modo !== null && (
          <div className="mt-6 rounded-[14px] border border-line bg-surface p-4">
            <p className="ledger-eyebrow">Classificação para o DRE</p>
            <p className="mt-1 mb-3 text-xs text-ledger-muted">
              {modo === "existente"
                ? "Opcional: o que for escolhido aqui atualiza o título vinculado, com registro no histórico."
                : "O lançamento nasce já classificado. O que ficar em branco aparece como pendente de classificação."}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {modo === "novo" && (
                <div className="sm:col-span-2">
                  <Rotulo>{saida ? "Pago para" : "Recebido de"} (obrigatório)</Rotulo>
                  <SmartSelect
                    options={partyOpcoes}
                    value={party}
                    onChange={setParty}
                    onSearch={setPartyBusca}
                    loading={contrapartes.isFetching}
                    placeholder="Buscar consultora, fornecedor, cliente…"
                    searchPlaceholder="Nome ou código"
                  />
                  {partySel && partySel.papeis.length > 0 && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-bronze">
                      <UserRound aria-hidden className="size-3.5" /> {papeisTexto(partySel.papeis)}
                    </p>
                  )}
                </div>
              )}
              <div className="sm:col-span-2">
                <Rotulo>Centro de custo</Rotulo>
                <SmartSelect options={opcoesCentro} value={centro} onChange={setCentro} placeholder="Pendente de classificação" />
                {centroSel && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-ledger-text">
                    <UserRound aria-hidden className="size-3.5 text-bronze" />
                    {centroSel.responsavel_nome
                      ? `Ligado a ${centroSel.responsavel_nome}${centroSel.papeis.length ? ` — ${papeisTexto(centroSel.papeis)}` : ""}`
                      : "Sem consultora ou fornecedor ligado a este centro"}
                  </p>
                )}
              </div>
              <div>
                <Rotulo>Conta contábil</Rotulo>
                <SmartSelect
                  options={[
                    { value: "", label: "Pendente de classificação" },
                    ...(classes.data?.planos ?? []).map((p) => ({ value: p.id, label: `${p.codigo} · ${p.nome}`, hint: p.natureza })),
                  ]}
                  value={plano}
                  onChange={setPlano}
                  placeholder="Pendente de classificação"
                />
              </div>
              <div>
                <Rotulo>Forma de {saida ? "pagamento" : "recebimento"}</Rotulo>
                <SmartSelect
                  options={[{ value: "", label: "Não informada" }, ...(classes.data?.formas ?? []).map((f) => ({ value: f.id, label: f.nome }))]}
                  value={forma}
                  onChange={setForma}
                  placeholder="Não informada"
                />
              </div>
            </div>

            <p className="ledger-eyebrow mt-5">Informações complementares</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {modo === "novo" && (
                <label className="sm:col-span-2">
                  <Rotulo>Descrição do lançamento</Rotulo>
                  <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={campoCls} />
                </label>
              )}
              <label>
                <Rotulo>Documento / nota</Rotulo>
                <input value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="Nº da nota, contrato…" className={campoCls} />
              </label>
              <label>
                <Rotulo>Observação</Rotulo>
                <input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: referente a setembro" className={campoCls} />
              </label>
            </div>
          </div>
        )}

        <div
          className={`mt-4 flex items-center justify-between rounded-[14px] p-4 transition ${
            pronto ? "bg-primary text-primary-foreground" : "bg-cream-2 text-ledger-text"
          }`}
        >
          <span className="text-sm font-semibold">
            {modo === "novo"
              ? pronto
                ? "Pronto para criar e conciliar"
                : "Escolha quem recebeu ou pagou"
              : bandeja.length === 0
                ? "Falta vincular"
                : bateExistente
                  ? "Bate certinho"
                  : falta > 0
                    ? "Ainda falta"
                    : "Passou do valor em"}
          </span>
          <span className="flex items-center gap-2 text-2xl font-bold tabular-nums">
            {pronto ? <Check aria-hidden className="size-6" /> : modo === "novo" ? formatBRLFromCents(valorLinha) : formatBRLFromCents(Math.abs(falta))}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {podeConciliar && (
            <button type="button" className="admin-btn-primary h-12 flex-1 text-base" disabled={!pronto || aplicar.isPending} onClick={() => aplicar.mutate()}>
              <Check aria-hidden className="mr-1 inline size-5" />
              {aplicar.isPending ? "Gravando…" : modo === "novo" ? "Criar lançamento e conciliar" : "Conciliar"}
            </button>
          )}
          <button type="button" className="admin-btn h-12" onClick={onPular}>
            <SkipForward aria-hidden className="mr-1 inline size-4" /> Deixar para depois
          </button>
        </div>
        <p className="mt-2 text-xs text-ledger-muted">Atalhos: 1 já existe · 2 é novo · Ctrl+Enter grava · P deixa para depois · Esc fecha</p>

        {podeMarcar && (
          <div className="mt-6 border-t border-line pt-4">
            {!marcando ? (
              <button type="button" className="text-sm font-semibold text-bronze underline-offset-4 hover:underline" onClick={() => setMarcando(true)}>
                Ignorar ou marcar divergência
              </button>
            ) : (
              <div className="space-y-2">
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (obrigatório)" className={campoCls} />
                <div className="flex gap-2">
                  <button type="button" className="admin-btn" disabled={!motivo.trim()} onClick={() => marcar.mutate("ignorada")}>
                    Ignorar lançamento
                  </button>
                  <button type="button" className="admin-btn" disabled={!motivo.trim()} onClick={() => marcar.mutate("divergente")}>
                    Marcar divergência
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Direita */}
      {modo === "novo" ? (
        <section className="flex min-h-0 flex-col gap-4 overflow-y-auto p-6">
          <div className="ledger-panel p-6">
            <p className="ledger-eyebrow">Resumo do novo lançamento</p>
            <dl className="mt-4 space-y-3 text-sm">
              {(
                [
                  ["Tipo", saida ? "Conta a pagar (já paga)" : "Conta a receber (já recebida)"],
                  [saida ? "Pago para" : "Recebido de", partyOpcoes.find((o) => o.value === party)?.label ?? "—"],
                  ["Valor", formatBRLFromCents(valorLinha)],
                  ["Data e competência", dataBR(linha.data)],
                  ["Centro de custo", centroSel ? `${centroSel.codigo} · ${centroSel.nome}` : "Pendente"],
                  ["Conta contábil", classes.data?.planos.find((p) => p.id === plano)?.nome ?? "Pendente"],
                  ["Forma", classes.data?.formas.find((f) => f.id === forma)?.nome ?? "Não informada"],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-line-soft pb-2">
                  <dt className="text-ledger-muted">{k}</dt>
                  <dd className="text-right font-semibold tabular-nums text-ledger-text">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-ledger-muted">
              Ao gravar, o sistema cria o título com uma parcela, dá a baixa nesta conta bancária e liga ao extrato. Tudo fica na
              auditoria e pode ser desfeito com motivo.
            </p>
          </div>
          {sugestoes.data && sugestoes.data.length > 0 && (
            <button type="button" className="admin-btn" onClick={() => setModo("existente")}>
              Há {sugestoes.data.length} conta(s) parecida(s) já lançada(s) — ver
            </button>
          )}
        </section>
      ) : (
        <section className="flex min-h-0 flex-col p-6">
          <div className="flex gap-2">
            {(["sugestoes", "buscar"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAba(a)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  aba === a ? "bg-primary text-primary-foreground" : "bg-cream-2 text-ledger-text hover:bg-cream-2/70"
                }`}
              >
                {a === "sugestoes" ? `Sugestões${sugestoes.data ? ` (${sugestoes.data.length})` : ""}` : "Procurar outra conta"}
              </button>
            ))}
          </div>
          {aba === "buscar" && (
            <div className="relative mt-3">
              <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ledger-muted" />
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={`Nome, descrição ou número — ${saida ? "contas a pagar" : "contas a receber"} em aberto`}
                className="h-12 w-full rounded-[12px] border border-line bg-surface pl-10 pr-3 text-base outline-none focus:border-champagne"
              />
            </div>
          )}

          <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {carregando && <Skeleton className="h-24 w-full" />}
            {!carregando && candidatas.length === 0 && (
              <div className="rounded-[14px] bg-cream-2 p-6 text-center text-sm text-ledger-muted">
                {aba === "sugestoes" ? (
                  <>
                    Nenhuma sugestão automática.{" "}
                    <button type="button" className="font-semibold text-bronze underline" onClick={() => setAba("buscar")}>
                      Procurar outra conta
                    </button>{" "}
                    ou{" "}
                    <button type="button" className="font-semibold text-bronze underline" onClick={() => setModo("novo")}>
                      lançar como novo
                    </button>
                  </>
                ) : (
                  "Nenhuma conta em aberto encontrada."
                )}
              </div>
            )}
          {candidatas.map((c) => {
            const escolhida = bandeja.some((b) => b.c.installment_id === c.installment_id);
            const exato = c.aberto_cents === valorLinha;
            return (
              <button
                key={c.installment_id}
                type="button"
                onClick={() => adicionar(c)}
                className={`group flex w-full items-center gap-4 rounded-[14px] border-2 p-4 text-left transition ${
                  escolhida ? "border-bronze bg-surface shadow-md" : "border-line bg-surface hover:border-champagne hover:shadow-sm"
                }`}
              >
                {c.score !== undefined && (
                  <div
                    className={`flex size-14 shrink-0 flex-col items-center justify-center rounded-full text-sm font-bold ${
                      c.score >= 70 ? "bg-primary text-primary-foreground" : "bg-cream-2 text-ledger-text"
                    }`}
                    title="Confiança da sugestão"
                  >
                    {c.score}%
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ledger-text">{c.titulo}</p>
                  <p className="truncate text-sm text-ledger-muted">
                    {c.contraparte ?? "Sem nome"} · vence {dataBR(c.vencimento)}
                  </p>
                  {c.motivos && c.motivos.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.motivos.map((m) => (
                        <span key={m} className="rounded-full bg-cream-2 px-2 py-0.5 text-[11px] font-semibold text-ledger-text">
                          {m}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold tabular-nums text-ledger-text">{formatBRLFromCents(c.aberto_cents)}</p>
                  <p className={`text-[11px] font-semibold ${exato ? "text-bronze" : "text-ledger-muted"}`}>
                    {exato ? "valor igual" : "em aberto"}
                  </p>
                </div>
                {escolhida ? (
                  <Check aria-hidden className="size-6 shrink-0 text-bronze" />
                ) : (
                  <ChevronRight aria-hidden className="size-5 shrink-0 text-ledger-muted group-hover:text-bronze" />
                )}
              </button>
            );
          })}
        </div>
        </section>
      )}
    </>
  );
}
