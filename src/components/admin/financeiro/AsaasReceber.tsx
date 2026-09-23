import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { EmptyState, Panel, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import {
  AVISO_SIMULACAO,
  PreparacaoNaoAplicada,
  carregarPainel,
  prepararCobranca,
  situacaoCobranca,
  type LinhaReceber,
} from "@/lib/asaas-painel";

const ABAS = [
  { id: "recebiveis", label: "Contas a receber" },
  { id: "importacao", label: "Prévia de importação" },
  { id: "ocorrencias", label: "Ocorrências e conciliação" },
  { id: "erros", label: "Fila de erros" },
] as const;
type Aba = (typeof ABAS)[number]["id"];

function Avisos() {
  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge tone="danger">Asaas não conectado</StatusBadge>
      <StatusBadge tone="warning">Modo de simulação</StatusBadge>
    </div>
  );
}

export function AsaasReceber() {
  const [aba, setAba] = React.useState<Aba>("recebiveis");
  const [parcela, setParcela] = React.useState<LinhaReceber | null>(null);
  const qc = useQueryClient();

  const painel = useQuery({
    queryKey: ["asaas", "painel"],
    queryFn: () => carregarPainel(50, 0),
    retry: false,
  });

  const preparar = useMutation({
    mutationFn: (dados: { conta: string; linha: LinhaReceber; forma: string }) =>
      prepararCobranca({
        account_id: dados.conta,
        installment_id: dados.linha.installment_id,
        billing_type: dados.forma,
      }),
    onSuccess: (r) => {
      toast.success(r.aviso ?? "Cobrança preparada. Nenhuma baixa foi criada.");
      void qc.invalidateQueries({ queryKey: ["asaas", "painel"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (painel.error instanceof PreparacaoNaoAplicada) {
    return (
      <div className="space-y-6">
        <Avisos />
        <Panel title="Recebíveis Asaas">
          <EmptyState
            title="Preparação ainda não aplicada a este ambiente"
            description="As rotinas de importação e de cobrança existem apenas no pacote preparado e no ambiente isolado de testes. Nada foi aplicado ao banco em uso."
          />
        </Panel>
      </div>
    );
  }

  const dados = painel.data;
  const conta = dados?.contas[0];

  return (
    <div className="space-y-6">
      <Avisos />

      <nav className="flex flex-wrap gap-2" aria-label="Seções de recebíveis Asaas">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            aria-current={aba === a.id ? "page" : undefined}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
              aba === a.id ? "border-bronze text-bronze" : "border-line text-ledger-muted hover:border-bronze"
            }`}
          >
            {a.label}
          </button>
        ))}
      </nav>

      {painel.isLoading && <Panel><p className="text-sm text-ledger-muted">Carregando…</p></Panel>}

      {aba === "recebiveis" && dados && (
        <Panel title="Parcelas a receber e situação da cobrança" flush>
          {dados.itens.length === 0 ? (
            <div className="px-6 py-5">
              <EmptyState title="Sem parcelas" description="Nenhuma parcela a receber neste recorte." />
            </div>
          ) : (
            <div className="min-w-0 overflow-x-auto">
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
                  {dados.itens.map((l) => {
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
                          <button
                            type="button"
                            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:border-bronze hover:text-bronze"
                            onClick={() => setParcela(l)}
                          >
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
        </Panel>
      )}

      {aba === "importacao" && (
        <Panel title="Prévia de importação">
          <p className="text-sm text-ledger-muted">
            Selecionar conta, período e consultar pelo adaptador. A prévia classifica cada recebível
            (histórico informativo, saldo devedor, pagamento já refletido na abertura, novo recebimento) e
            não cria título, parcela nem baixa. A efetivação depende de aprovação registrada pelo servidor.
          </p>
          <p className="mt-3 text-sm text-ledger-muted">
            Conta disponível: <strong>{conta ? `${conta.nome} (${conta.ambiente})` : "nenhuma conta preparada"}</strong>.
            Enquanto o Asaas não estiver conectado, a consulta usa o provedor simulado.
          </p>
          <p className="mt-3 text-sm font-semibold text-warning">
            Revisão de clientes e duplicidades: correspondências por documento ambíguo ficam pendentes de decisão
            humana. Pessoas nunca são vinculadas por nome.
          </p>
        </Panel>
      )}

      {aba === "ocorrencias" && dados && (
        <Panel title="Ocorrências recebidas do provedor">
          {dados.ocorrencias.length === 0 ? (
            <EmptyState title="Sem ocorrências na fila" description="Nenhum evento aguardando conciliação." />
          ) : (
            <ul className="space-y-2 text-sm">
              {dados.ocorrencias.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-4 py-3">
                  <span className="font-medium">{o.event}</span>
                  <span className="text-ledger-muted">{o.cobranca ?? "—"}</span>
                  <StatusBadge tone={o.classificacao === "conhecido" ? "info" : "warning"}>{o.classificacao}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {aba === "erros" && dados && (
        <Panel title="Fila de erros e resultados desconhecidos">
          {dados.fila_erros.length === 0 ? (
            <EmptyState title="Fila vazia" description="Nenhuma tentativa rejeitada ou inconclusiva." />
          ) : (
            <ul className="space-y-2 text-sm">
              {dados.fila_erros.map((f) => (
                <li key={f.id} className="rounded-lg border border-line px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge tone="danger">{f.state}</StatusBadge>
                    <span className="text-xs text-ledger-muted">{f.attempts} tentativa(s)</span>
                  </div>
                  <p className="mt-2 text-ledger-muted">{f.erro ?? "Resultado desconhecido: consultar o provedor antes de reenviar."}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {parcela && (
        <Panel title="Detalhe da parcela e vínculo Asaas">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-ledger-muted">Devedor</dt><dd className="font-medium">{parcela.pessoa ?? "—"}</dd></div>
            <div><dt className="text-ledger-muted">Saldo no servidor</dt><dd className="font-medium tabular-nums">{formatBRLFromCents(parcela.saldo_cents)}</dd></div>
            <div><dt className="text-ledger-muted">Cobrança vinculada</dt><dd className="font-medium">{parcela.cobranca?.external_id ?? "nenhuma"}</dd></div>
            <div><dt className="text-ledger-muted">Situação</dt><dd className="font-medium">{situacaoCobranca(parcela).rotulo}</dd></div>
          </dl>

          {parcela.intencao?.invoice_url ? (
            <div className="mt-5 rounded-lg border border-warning px-4 py-3">
              <p className="text-sm font-semibold text-warning">{AVISO_SIMULACAO}</p>
              <Link to={parcela.intencao.invoice_url} className="mt-2 inline-block text-sm font-semibold text-bronze underline">
                Abrir demonstração local
              </Link>
              <button type="button" disabled className="ml-4 cursor-not-allowed text-sm text-ledger-muted" title="Disponível somente quando o Asaas estiver conectado">
                Copiar link real (indisponível)
              </button>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!conta || parcela.saldo_cents <= 0 || preparar.isPending}
                onClick={() => conta && preparar.mutate({ conta: conta.id, linha: parcela, forma: "PIX" })}
                className="rounded-lg border border-bronze px-4 py-2 text-sm font-semibold text-bronze disabled:opacity-50"
              >
                Solicitar cobrança simulada (PIX)
              </button>
              <span className="text-xs text-ledger-muted">
                Gerar link não liquida a parcela, não comprova venda e não emite nota fiscal.
              </span>
            </div>
          )}

          <button type="button" className="mt-5 text-sm text-ledger-muted underline" onClick={() => setParcela(null)}>
            Fechar detalhe
          </button>
        </Panel>
      )}
    </div>
  );
}
