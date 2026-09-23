import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { EmptyState, Panel, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import {
  AVISO_SIMULACAO,
  PreparacaoNaoAplicada,
  carregarPainel,
  situacaoCobranca,
  type LinhaReceber,
} from "@/lib/asaas-painel";
import { demoEvento, demoGerarLink, demoRecuperar } from "@/lib/asaas/demo.functions";
import { AsaasImportacao } from "./AsaasImportacao";

function DetalheParcela({ conta, linha, onFechar }: { conta: string; linha: LinhaReceber; onFechar: () => void }) {
  const qc = useQueryClient();
  const gerar = useServerFn(demoGerarLink);
  const recuperar = useServerFn(demoRecuperar);
  const evento = useServerFn(demoEvento);
  const [forma, setForma] = React.useState<"PIX" | "BOLETO">("PIX");
  const [ultimo, setUltimo] = React.useState<string | null>(null);
  const atualizar = () => void qc.invalidateQueries({ queryKey: ["asaas", "painel"] });
  const falhou = (e: Error) => toast.error(e.message);

  const solicitar = useMutation({
    mutationFn: (perderResposta: boolean) => gerar({ data: { accountId: conta, installmentId: linha.installment_id, billingType: forma, perderResposta } }),
    onSuccess: (r) => { setUltimo(`Situação: ${r.state}${r.reaproveitada ? " (cobrança existente reaproveitada)" : ""}`); atualizar(); },
    onError: falhou,
  });
  const recuperarM = useMutation({
    mutationFn: () => recuperar({ data: { intentId: linha.intencao!.id } }),
    onSuccess: (r) => { setUltimo(`Consulta ao provedor: ${r.state}. Chamadas de criação no provedor: ${r.chamadas_criar}.`); atualizar(); },
    onError: falhou,
  });
  const eventoM = useMutation({
    mutationFn: (repetir: boolean) => evento({ data: { accountId: conta, chargeExternalId: linha.cobranca!.external_id!, pagoCents: linha.saldo_cents, tarifaCents: 199, repetir } }),
    onSuccess: (r) => {
      const partes = r.map((e) => (e.repetido ? "repetido (sem novo efeito)" : `${e.efeito ?? "registrado"}${e.revisao_manual ? " · revisão manual" : ""}`));
      setUltimo(`Evento: ${partes.join(" / ")}. Nenhuma baixa foi criada.`);
      atualizar();
    },
    onError: falhou,
  });
  const ocupado = solicitar.isPending || recuperarM.isPending || eventoM.isPending;
  const estado = linha.intencao?.state;

  return (
    <Panel title="Detalhe da parcela e vínculo Asaas">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-ledger-muted">Devedor</dt><dd className="font-medium">{linha.pessoa ?? "—"}</dd></div>
        <div><dt className="text-ledger-muted">Saldo no servidor</dt><dd className="font-medium tabular-nums" data-testid="saldo-parcela">{formatBRLFromCents(linha.saldo_cents)}</dd></div>
        <div><dt className="text-ledger-muted">Cobrança vinculada</dt><dd className="font-medium break-all" data-testid="cobranca-vinculada">{linha.cobranca?.external_id ?? "nenhuma"}</dd></div>
        <div><dt className="text-ledger-muted">Situação</dt><dd className="font-medium" data-testid="situacao">{situacaoCobranca(linha).rotulo}</dd></div>
      </dl>

      {linha.intencao?.invoice_url && (
        <div className="mt-5 rounded-lg border border-warning px-4 py-3">
          <p className="text-sm font-semibold text-warning">{AVISO_SIMULACAO}</p>
          <a href={linha.intencao.invoice_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-bronze underline">
            Abrir demonstração local
          </a>
          <button type="button" disabled className="ml-4 cursor-not-allowed text-sm text-ledger-muted" title="Disponível somente quando o Asaas estiver conectado">
            Copiar link real (indisponível)
          </button>
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
        <button type="button" disabled={linha.saldo_cents <= 0 || ocupado} onClick={() => solicitar.mutate(false)}
          className="rounded-lg border border-bronze px-4 py-2 text-sm font-semibold text-bronze disabled:opacity-50">
          {linha.intencao?.invoice_url ? "Solicitar de novo (reaproveita)" : "Solicitar cobrança simulada"}
        </button>
        {!linha.intencao && (
          <button type="button" disabled={ocupado} onClick={() => solicitar.mutate(true)}
            className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ledger-muted">
            Simular resposta perdida
          </button>
        )}
        {estado === "desconhecida" && (
          <button type="button" disabled={ocupado} onClick={() => recuperarM.mutate()}
            className="rounded-lg border border-danger px-4 py-2 text-sm font-semibold text-danger">
            Consultar provedor e recuperar
          </button>
        )}
        {linha.cobranca?.external_id && (
          <>
            <button type="button" disabled={ocupado} onClick={() => eventoM.mutate(false)}
              className="rounded-lg border border-line px-3 py-2 text-xs font-semibold">Simular recebimento (evento)</button>
            <button type="button" disabled={ocupado} onClick={() => eventoM.mutate(true)}
              className="rounded-lg border border-line px-3 py-2 text-xs font-semibold">Evento repetido</button>
          </>
        )}
      </div>
      <p className="mt-3 text-xs text-ledger-muted">Gerar link não liquida a parcela, não comprova venda e não emite nota fiscal.</p>
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

  const painel = useQuery({
    queryKey: ["asaas", "painel"],
    queryFn: () => carregarPainel(200, 0),
    retry: false,
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

      {aba === "importacao" && <AsaasImportacao contaId={conta?.id} />}

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

      {parcela && conta && (
        <DetalheParcela
          conta={conta.id}
          linha={dados?.itens.find((i) => i.installment_id === parcela.installment_id) ?? parcela}
          onFechar={() => setParcela(null)}
        />
      )}
    </div>
  );
}
