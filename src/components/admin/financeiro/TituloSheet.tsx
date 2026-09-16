import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SmartSelect } from "@/components/premium/SmartSelect";
import {
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  formatBRLFromCents,
  formatDateTime,
} from "@/components/admin/ui";
import { useCapabilities } from "@/lib/capabilities";
import { ClassificarTituloDialog } from "@/components/admin/financeiro/ClassificacaoCampos";
import { PedirDadosDialog } from "@/components/admin/financeiro/PedirDadosDialog";
import {
  cancelarTitulo,
  estornarBaixa,
  fetchFinAccounts,
  fetchFinTitle,
  registrarBaixa,
  registrarReconhecimento,
  submeterTitulo,
  reaisParaCentavos,
  TITLE_STATUS_LABEL,
  type FinInstallment,
} from "@/lib/financeiro";

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

const dataBR = (d: string) => new Intl.DateTimeFormat("pt-BR").format(new Date(`${d}T12:00:00`));

function saldoParcela(p: FinInstallment) {
  return p.valor_cents + p.ajustes_cents - p.pago_cents;
}

/** Ficha do título: parcelas, baixas, reconhecimento e histórico. */
export function TituloSheet({
  id,
  onOpenChange,
}: {
  id: string | null;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const caps = useCapabilities();
  const podeBaixar = caps.includes("finance.settlement.create");
  const podeEstornar = caps.includes("finance.settlement.reverse");

  const detalhe = useQuery({
    queryKey: ["fin-title", id],
    queryFn: () => fetchFinTitle(id as string),
    enabled: !!id,
  });
  const contas = useQuery({
    queryKey: ["fin-accounts"],
    queryFn: fetchFinAccounts,
    enabled: !!id && podeBaixar,
  });

  const [parcela, setParcela] = React.useState("");
  const [conta, setConta] = React.useState("");
  const [valor, setValor] = React.useState("");
  const [referencia, setReferencia] = React.useState("");
  const [chave] = React.useState(() => crypto.randomUUID());
  const [estornando, setEstornando] = React.useState<string | null>(null);
  const [cancelando, setCancelando] = React.useState(false);
  const [reconhecendo, setReconhecendo] = React.useState(false);
  const [classificando, setClassificando] = React.useState(false);

  const t = detalhe.data;

  const baixar = useMutation({
    mutationFn: async () => {
      if (!t) throw new Error("Título não carregado.");
      if (!parcela) throw new Error("Escolha a parcela.");
      if (!conta) throw new Error("Escolha a conta.");
      const cents = reaisParaCentavos(valor);
      if (!cents || cents <= 0) throw new Error("Informe um valor maior que zero.");
      return registrarBaixa({
        direction: t.titulo.direction,
        financial_account_id: conta,
        valor_cents: cents,
        ...(referencia.trim() ? { referencia: referencia.trim() } : {}),
        idempotency_key: `${chave}-${parcela}-${cents}`,
        alocacoes: [{ installment_id: parcela, valor_cents: cents }],
      });
    },
    onSuccess: (r) => {
      toast.success(r.repetido ? "Esta baixa já havia sido registrada." : "Baixa registrada.");
      setValor("");
      void qc.invalidateQueries({ queryKey: ["fin-title", id] });
      void qc.invalidateQueries({ queryKey: ["fin-titles"] });
      void qc.invalidateQueries({ queryKey: ["fin-overview"] });
      void qc.invalidateQueries({ queryKey: ["fin-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const estornar = useMutation({
    mutationFn: async (v: { settlementId: string; motivo: string }) => {
      if (!v.motivo.trim()) throw new Error("Estorno exige motivo.");
      return estornarBaixa(v.settlementId, v.motivo.trim());
    },
    onSuccess: () => {
      toast.success("Estorno registrado com lançamento compensatório.");
      setEstornando(null);
      void qc.invalidateQueries({ queryKey: ["fin-title", id] });
      void qc.invalidateQueries({ queryKey: ["fin-overview"] });
      void qc.invalidateQueries({ queryKey: ["fin-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelar = useMutation({
    mutationFn: async (motivo: string) => {
      if (!motivo.trim()) throw new Error("Cancelamento exige motivo.");
      return cancelarTitulo(id as string, motivo.trim());
    },
    onSuccess: () => {
      toast.success("Título cancelado. O histórico permanece.");
      setCancelando(false);
      void qc.invalidateQueries({ queryKey: ["fin-title", id] });
      void qc.invalidateQueries({ queryKey: ["fin-titles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submeter = useMutation({
    mutationFn: async () => submeterTitulo(id as string),
    onSuccess: () => {
      toast.success("Título enviado para aprovação.");
      void qc.invalidateQueries({ queryKey: ["fin-title", id] });
      void qc.invalidateQueries({ queryKey: ["fin-titles"] });
      void qc.invalidateQueries({ queryKey: ["fin-pending"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reconhecer = useMutation({
    mutationFn: async (v: Record<string, string>) => {
      const cents = reaisParaCentavos(v["reconhecido"] ?? "");
      if (cents === null || cents < 0) throw new Error("Valor reconhecido inválido.");
      const contest = reaisParaCentavos(v["contestado"] ?? "0");
      return registrarReconhecimento(id as string, cents, contest ?? 0, (v["motivo"] ?? "").trim());
    },
    onSuccess: () => {
      toast.success("Reconhecimento registrado.");
      setReconhecendo(false);
      void qc.invalidateQueries({ queryKey: ["fin-title", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reconhecido = (t?.reconhecimentos ?? []).reduce((s, r) => s + r.reconhecido_cents, 0);
  const contestado = (t?.reconhecimentos ?? []).reduce((s, r) => s + r.contestado_cents, 0);

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="admin-scope w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t ? t.titulo.descricao : "Título"}</SheetTitle>
          <SheetDescription>
            {t ? `${t.titulo.contraparte} · emissão ${dataBR(t.titulo.emissao)}` : "Carregando…"}
          </SheetDescription>
        </SheetHeader>

        {detalhe.isLoading && <Skeleton className="mt-6 h-40 w-full" />}
        {detalhe.error && <ErrorState message="Não foi possível abrir o título." />}

        {t && (
          <div className="mt-6 space-y-6 px-1 pb-10">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={t.titulo.status === "cancelado" ? "danger" : "success"}>
                {TITLE_STATUS_LABEL[t.titulo.status]}
              </StatusBadge>
              <span className="text-sm font-semibold text-ledger-text tabular-nums">
                {formatBRLFromCents(t.titulo.valor_cents)}
              </span>
              {t.titulo.documento && (
                <span className="text-sm text-ledger-muted">Doc. {t.titulo.documento}</span>
              )}
            </div>

            <section className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="ledger-eyebrow">Classificação</p>
                {(t.pode_classificar ?? false) && t.titulo.status !== "cancelado" ? (
                  <button
                    type="button"
                    className="admin-btn"
                    onClick={() => setClassificando(true)}
                  >
                    Classificar
                  </button>
                ) : null}
              </div>
              {t.titulo.pendente_classificacao ? (
                <p className="mt-2 text-sm font-semibold text-amber-700">
                  Pendente de classificação
                </p>
              ) : null}
              <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-ledger-muted">Conta contábil</dt>
                  <dd className="text-ledger-text">{t.titulo.plano_label ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ledger-muted">Centro de custo</dt>
                  <dd className="text-ledger-text">{t.titulo.centro_label ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ledger-muted">Entidade</dt>
                  <dd className="text-ledger-text">{t.titulo.entidade_label ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ledger-muted">Forma de pagamento</dt>
                  <dd className="text-ledger-text">{t.titulo.forma_label ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ledger-muted">Conta ou caixa prevista</dt>
                  <dd className="text-ledger-text">{t.titulo.conta_label ?? "—"}</dd>
                </div>
              </dl>
            </section>

            <ClassificarTituloDialog
              open={classificando}
              onOpenChange={setClassificando}
              tituloId={t.titulo.id}
              direction={t.titulo.direction}
              {...(t.titulo.updated_at ? { atualizadoEm: t.titulo.updated_at } : {})}
              exigeMotivo={t.baixas.length > 0}
              iniciais={{
                business_entity_id: t.titulo.business_entity_id ?? "",
                chart_account_id: t.titulo.chart_account_id ?? "",
                cost_center_id: t.titulo.cost_center_id ?? "",
                payment_method_id: t.titulo.payment_method_id ?? "",
                financial_account_id: t.titulo.financial_account_id ?? "",
              }}
            />

            <section>
              <p className="ledger-eyebrow">Parcelas</p>
              <ul className="mt-2 divide-y divide-line-soft border-y border-line-soft">
                {t.parcelas.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-sm font-medium text-ledger-text">
                      {p.numero}/{p.total_parcelas} · vence {dataBR(p.vencimento)}
                    </span>
                    <span className="text-sm tabular-nums text-ledger-muted">
                      {formatBRLFromCents(p.pago_cents)} de {formatBRLFromCents(p.valor_cents)} ·
                      saldo {formatBRLFromCents(saldoParcela(p))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {podeBaixar && t.titulo.status !== "cancelado" && (
              <section className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
                <p className="ledger-eyebrow">
                  {t.titulo.direction === "payable"
                    ? "Registrar pagamento"
                    : "Registrar recebimento"}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <SmartSelect
                    options={t.parcelas.map((p) => ({
                      value: p.id,
                      label: `Parcela ${p.numero} — ${dataBR(p.vencimento)}`,
                      hint: `saldo ${formatBRLFromCents(saldoParcela(p))}`,
                    }))}
                    value={parcela}
                    onChange={setParcela}
                    placeholder="Parcela"
                  />
                  <SmartSelect
                    options={(contas.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
                    value={conta}
                    onChange={setConta}
                    placeholder="Conta ou caixa"
                    emptyLabel="Nenhuma conta cadastrada"
                  />
                  <input
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    inputMode="decimal"
                    placeholder="Valor 0,00"
                    className={inputCls}
                  />
                  <input
                    value={referencia}
                    onChange={(e) => setReferencia(e.target.value)}
                    placeholder="Referência (opcional)"
                    className={inputCls}
                  />
                </div>
                <button
                  type="button"
                  className="admin-btn-primary mt-3"
                  disabled={baixar.isPending}
                  onClick={() => baixar.mutate()}
                >
                  {baixar.isPending ? "Gravando…" : "Gravar baixa"}
                </button>
              </section>
            )}

            <section>
              <p className="ledger-eyebrow">Baixas</p>
              {t.baixas.length === 0 ? (
                <EmptyState
                  title="Nenhuma baixa registrada"
                  description="Quando houver pagamento ou recebimento, ele aparece aqui com conta, data e valor."
                />
              ) : (
                <ul className="mt-2 divide-y divide-line-soft border-y border-line-soft">
                  {t.baixas.map((b, i) => (
                    <li
                      key={`${b.settlement_id}-${i}`}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="text-sm font-medium text-ledger-text">
                        {dataBR(b.data)} · parcela {b.parcela} · {b.conta ?? "—"}
                        {b.estorno ? " · estorno" : ""}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-sm tabular-nums text-ledger-muted">
                          {formatBRLFromCents(b.valor_cents)}
                        </span>
                        {podeEstornar && !b.estorno && b.valor_cents > 0 && (
                          <button
                            type="button"
                            className="admin-btn"
                            onClick={() => setEstornando(b.settlement_id)}
                          >
                            Estornar
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {t.titulo.direction === "receivable" && (
              <section>
                <p className="ledger-eyebrow">Reconhecimento da dívida</p>
                <p className="mt-2 text-sm text-ledger-muted">
                  Reconhecido {formatBRLFromCents(reconhecido)} · contestado{" "}
                  {formatBRLFromCents(contestado)} · diferença sem reconhecimento{" "}
                  {formatBRLFromCents(Math.max(0, t.titulo.valor_cents - reconhecido - contestado))}
                </p>
                <button
                  type="button"
                  className="admin-btn mt-3"
                  onClick={() => setReconhecendo(true)}
                >
                  Registrar reconhecimento
                </button>
              </section>
            )}

            <section>
              <p className="ledger-eyebrow">Histórico</p>
              <ul className="mt-2 space-y-1.5">
                {t.eventos.map((ev) => (
                  <li key={ev.id} className="text-sm text-ledger-muted">
                    {formatDateTime(ev.created_at)} — {ev.evento}
                    {ev.motivo ? ` (${ev.motivo})` : ""}
                  </li>
                ))}
              </ul>
            </section>

            {t.titulo.status !== "cancelado" && (
              <div className="flex flex-wrap gap-2">
                {t.titulo.status === "rascunho" && (
                  <button
                    type="button"
                    className="admin-btn-primary"
                    disabled={submeter.isPending}
                    onClick={() => submeter.mutate()}
                  >
                    Enviar para aprovação
                  </button>
                )}
                <button type="button" className="admin-btn" onClick={() => setCancelando(true)}>
                  Cancelar título
                </button>
              </div>
            )}
          </div>
        )}
        <PedirDadosDialog
          open={!!estornando}
          titulo="Estornar baixa"
          descricao="O estorno gera lançamento compensatório e fica registrado no histórico."
          campos={[
            { nome: "motivo", rotulo: "Motivo do estorno", tipo: "area", obrigatorio: true },
          ]}
          confirmar="Estornar"
          onOpenChange={(v) => !v && setEstornando(null)}
          onConfirmar={(vals) =>
            estornar.mutate({
              settlementId: estornando as string,
              motivo: vals["motivo"] ?? "",
            })
          }
        />

        <PedirDadosDialog
          open={cancelando}
          titulo="Cancelar título"
          descricao="O título deixa de ser cobrado, mas o histórico permanece."
          campos={[
            { nome: "motivo", rotulo: "Motivo do cancelamento", tipo: "area", obrigatorio: true },
          ]}
          confirmar="Cancelar título"
          onOpenChange={setCancelando}
          onConfirmar={(vals) => cancelar.mutate(vals["motivo"] ?? "")}
        />

        <PedirDadosDialog
          open={reconhecendo}
          titulo="Registrar reconhecimento"
          descricao="Informe quanto a contraparte reconhece e quanto contesta."
          campos={[
            {
              nome: "reconhecido",
              rotulo: "Valor reconhecido (R$)",
              tipo: "valor",
              obrigatorio: true,
            },
            { nome: "contestado", rotulo: "Valor contestado (R$)", tipo: "valor", padrao: "0" },
            { nome: "motivo", rotulo: "Motivo", tipo: "area" },
          ]}
          onOpenChange={setReconhecendo}
          onConfirmar={(vals) => reconhecer.mutate(vals)}
        />
      </SheetContent>
    </Sheet>
  );
}
