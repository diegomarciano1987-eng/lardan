import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { formatBRLFromCents } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import {
  buscarContrapartes,
  criarTitulo,
  fetchFinAccounts,
  registrarBaixa,
  reaisParaCentavos,
  type FinDirection,
} from "@/lib/financeiro";
import {
  CLASSIFICACAO_VAZIA,
  CamposClassificacao,
  type ValoresClassificacao,
} from "@/components/admin/financeiro/ClassificacaoCampos";

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Divide um total em n parcelas mensais; centavos que sobram vão na última. */
export function dividirEmParcelas(totalCents: number, n: number, inicio: Date): ParcelaForm[] {
  const base = Math.floor(totalCents / n);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
    const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(inicio.getDate(), ultimo));
    const cents = i === n - 1 ? totalCents - base * (n - 1) : base;
    return { vencimento: d, valor: (cents / 100).toFixed(2).replace(".", ",") };
  });
}

export interface ParcelaForm {
  vencimento: Date | undefined;
  valor: string;
}

/** Cadastro de título a pagar ou a receber, com parcelas conferidas no servidor. */
export function NovoTituloDialog({
  open,
  onOpenChange,
  direction: direcaoInicial,
  escolherDirecao = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  direction: FinDirection;
  /** mostra a escolha entre a pagar e a receber */
  escolherDirecao?: boolean;
}) {
  const qc = useQueryClient();
  const [direction, setDirection] = React.useState<FinDirection>(direcaoInicial);
  React.useEffect(() => {
    if (open) setDirection(direcaoInicial);
  }, [open, direcaoInicial]);
  const [divQtd, setDivQtd] = React.useState("");
  const [divTotal, setDivTotal] = React.useState("");
  const [divInicio, setDivInicio] = React.useState<Date | undefined>(undefined);
  const [jaPago, setJaPago] = React.useState(false);
  const [contaBaixa, setContaBaixa] = React.useState("");
  const [dataBaixa, setDataBaixa] = React.useState<Date | undefined>(new Date());
  const contas = useQuery({ queryKey: ["fin-accounts"], queryFn: fetchFinAccounts, enabled: open });
  const contaEscolhida = (contas.data ?? []).find((c) => c.id === contaBaixa);
  const ehCartao = !!contaEscolhida && (contaEscolhida.kind === "cartao_credito" || /cart[aã]o/i.test(contaEscolhida.nome));

  const dividir = () => {
    const n = Number.parseInt(divQtd, 10);
    const tot = reaisParaCentavos(divTotal);
    if (!Number.isFinite(n) || n < 1 || n > 120) return void toast.error("Informe em quantas vezes (1 a 120).");
    if (!tot || tot <= 0) return void toast.error("Informe o valor total.");
    if (!divInicio) return void toast.error("Informe o primeiro vencimento.");
    setParcelas(dividirEmParcelas(tot, n, divInicio));
  };
  const [busca, setBusca] = React.useState("");
  const [party, setParty] = React.useState("");
  const [descricao, setDescricao] = React.useState("");
  const [documento, setDocumento] = React.useState("");
  const [emissao, setEmissao] = React.useState<Date | undefined>(new Date());
  const [competencia, setCompetencia] = React.useState<Date | undefined>(new Date());
  const [observacao, setObservacao] = React.useState("");
  const [classificacao, setClassificacao] =
    React.useState<ValoresClassificacao>(CLASSIFICACAO_VAZIA);
  const [parcelas, setParcelas] = React.useState<ParcelaForm[]>([
    { vencimento: undefined, valor: "" },
  ]);
  const [recQtd, setRecQtd] = React.useState("");
  const [recInicio, setRecInicio] = React.useState<Date | undefined>(undefined);
  const [recValor, setRecValor] = React.useState("");

  const gerarRecorrencia = () => {
    const n = Number.parseInt(recQtd, 10);
    if (!Number.isFinite(n) || n < 1 || n > 360) {
      toast.error("Informe quantas vezes a conta se repete.");
      return;
    }
    if (!recInicio) {
      toast.error("Informe o primeiro vencimento.");
      return;
    }
    if (!reaisParaCentavos(recValor)) {
      toast.error("Informe o valor de cada parcela.");
      return;
    }
    setParcelas(
      Array.from({ length: n }, (_, i) => {
        const d = new Date(recInicio);
        d.setMonth(d.getMonth() + i);
        return { vencimento: d, valor: recValor };
      }),
    );
  };

  React.useEffect(() => {
    if (!open) {
      setParty("");
      setDescricao("");
      setDocumento("");
      setObservacao("");
      setClassificacao(CLASSIFICACAO_VAZIA);
      setParcelas([{ vencimento: undefined, valor: "" }]);
      setDivQtd("");
      setDivTotal("");
      setDivInicio(undefined);
      setJaPago(false);
      setContaBaixa("");
      setDataBaixa(new Date());
    }
  }, [open]);

  const contrapartes = useQuery({
    queryKey: ["fin-contrapartes", busca],
    queryFn: () => buscarContrapartes(busca),
    enabled: open,
  });

  const total = parcelas.reduce((s, p) => s + (reaisParaCentavos(p.valor) ?? 0), 0);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!party) throw new Error("Escolha a contraparte já cadastrada.");
      if (!descricao.trim()) throw new Error("Informe a descrição do título.");
      const linhas = parcelas.map((p) => {
        const cents = reaisParaCentavos(p.valor);
        if (!cents || cents <= 0) throw new Error("Toda parcela precisa de valor maior que zero.");
        if (!p.vencimento) throw new Error("Toda parcela precisa de vencimento.");
        return { vencimento: iso(p.vencimento), valor_cents: cents };
      });
      if (jaPago && !contaBaixa) throw new Error("Escolha a conta ou cartão por onde o dinheiro passou.");
      if (jaPago && !ehCartao && !dataBaixa) throw new Error("Informe a data do pagamento/recebimento.");
      const hojeSP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
      if (jaPago && !ehCartao && dataBaixa && iso(dataBaixa) > hojeSP) throw new Error("A data do pagamento não pode ser futura.");
      const idTitulo = await criarTitulo({
        direction,
        party_id: party,
        descricao: descricao.trim(),
        ...(documento.trim() ? { documento: documento.trim() } : {}),
        ...(emissao ? { emissao: iso(emissao) } : {}),
        ...(competencia ? { competencia: iso(competencia) } : {}),
        ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
        ...(classificacao.business_entity_id
          ? { business_entity_id: classificacao.business_entity_id }
          : {}),
        ...(classificacao.chart_account_id
          ? { chart_account_id: classificacao.chart_account_id }
          : {}),
        ...(classificacao.cost_center_id ? { cost_center_id: classificacao.cost_center_id } : {}),
        ...(classificacao.payment_method_id
          ? { payment_method_id: classificacao.payment_method_id }
          : {}),
        ...(jaPago && contaBaixa
          ? { financial_account_id: contaBaixa }
          : classificacao.financial_account_id
            ? { financial_account_id: classificacao.financial_account_id }
            : {}),
        valor_cents: linhas.reduce((s, l) => s + l.valor_cents, 0),
        parcelas: linhas,
      });
      if (!jaPago) return { baixas: 0, falhas: [] as string[] };
      const { data: parc, error } = await supabase
        .from("financial_installments")
        .select("id, numero, vencimento, valor_cents")
        .eq("title_id", idTitulo)
        .order("numero");
      if (error) throw new Error(`Título gravado, mas não consegui ler as parcelas para a baixa: ${error.message}`);
      const falhas: string[] = [];
      let baixas = 0;
      for (const p of parc ?? []) {
        // cartão: cada parcela cai no mês dela; conta comum: tudo na data informada
        const dataP = ehCartao ? p.vencimento : iso(dataBaixa as Date);
        try {
          await registrarBaixa({
            direction,
            financial_account_id: contaBaixa,
            data: dataP,
            valor_cents: p.valor_cents,
            idempotency_key: `novo-titulo:${idTitulo}:${p.id}`,
            alocacoes: [{ installment_id: p.id, valor_cents: p.valor_cents }],
            ...(classificacao.payment_method_id ? { payment_method_id: classificacao.payment_method_id } : {}),
          });
          baixas += 1;
        } catch (e) {
          falhas.push(`parcela ${p.numero}: ${(e as Error).message}`);
        }
      }
      return { baixas, falhas };
    },
    onSuccess: (r) => {
      if (r.falhas.length)
        toast.error(`Título gravado, mas ${r.falhas.length} baixa(s) não entraram: ${r.falhas.join("; ")}. Dê a baixa pela ficha do título.`);
      else toast.success(r.baixas ? `Título registrado e ${r.baixas} parcela(s) já baixada(s).` : "Título registrado.");
      void qc.invalidateQueries({ queryKey: ["fin-pr"] });
      void qc.invalidateQueries({ queryKey: ["fin-accounts"] });
      void qc.invalidateQueries({ queryKey: ["fin-titles"] });
      void qc.invalidateQueries({ queryKey: ["fin-overview"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-scope max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {direction === "payable" ? "Nova conta a pagar" : "Nova conta a receber"}
          </DialogTitle>
          <DialogDescription>
            A contraparte é sempre uma pessoa ou empresa já cadastrada. Nada é duplicado.
          </DialogDescription>
        </DialogHeader>

        {escolherDirecao ? (
          <div role="tablist" aria-label="Tipo" className="inline-flex w-fit rounded-[12px] border border-line bg-surface p-1">
            {(
              [
                ["payable", "A pagar"],
                ["receivable", "A receber"],
              ] as [FinDirection, string][]
            ).map(([v, r]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={direction === v}
                onClick={() => {
                  setDirection(v);
                  setClassificacao(CLASSIFICACAO_VAZIA);
                }}
                className={`min-h-10 rounded-[9px] px-4 text-sm font-semibold ${direction === v ? "bg-ledger-text text-surface" : "text-ledger-text"}`}
              >
                {r}
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Campo label={direction === "payable" ? "Favorecido" : "Devedor"}>
              <SmartSelect
                options={(contrapartes.data ?? []).map((c) => ({
                  value: c.id,
                  label: c.nome,
                  hint: c.hint,
                }))}
                value={party}
                onChange={setParty}
                placeholder="Buscar pessoa ou empresa"
                searchPlaceholder="Digite nome, documento ou código"
                searchThreshold={0}
              />
            </Campo>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Refinar busca de contraparte"
              className={`${inputCls} mt-2`}
            />
          </div>

          <div className="sm:col-span-2">
            <Campo label="Descrição">
              <input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                className={inputCls}
                placeholder="Ex.: Nota 1234 — fornecedor de embalagens"
              />
            </Campo>
          </div>

          <Campo label="Documento">
            <input
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              className={inputCls}
              placeholder="Nota, contrato ou referência"
            />
          </Campo>
          <Campo label="Emissão">
            <DateField value={emissao} onChange={setEmissao} />
          </Campo>
          <Campo label="Competência">
            <DateField value={competencia} onChange={setCompetencia} />
          </Campo>
          <Campo label="Observação">
            <input
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className={inputCls}
            />
          </Campo>
        </div>

        <div className="mt-2 rounded-[12px] border border-line-soft bg-cream-2 p-4">
          <p className="ledger-eyebrow">Classificação</p>
          <p className="mt-1 mb-3 text-xs font-medium text-ledger-muted">
            Opcional agora. O que ficar em branco aparece como “Pendente de classificação” e pode
            ser definido depois, com registro no histórico.
          </p>
          <CamposClassificacao
            direction={direction}
            valores={classificacao}
            onChange={setClassificacao}
          />
        </div>

        <div className="mt-2 rounded-[12px] border border-line-soft bg-cream-2 p-4">
          <p className="ledger-eyebrow">Parcelar (Nx)</p>
          <p className="mt-1 mb-3 text-xs font-medium text-ledger-muted">
            Divide o valor total em parcelas mensais. Os centavos que sobram vão na última. Dá para ajustar
            data e valor de cada parcela abaixo antes de gravar.
          </p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Campo label="Valor total">
              <input value={divTotal} onChange={(e) => setDivTotal(e.target.value)} inputMode="decimal" placeholder="0,00" className={inputCls} />
            </Campo>
            <Campo label="Em quantas vezes">
              <input value={divQtd} onChange={(e) => setDivQtd(e.target.value)} inputMode="numeric" placeholder="Ex.: 3" className={inputCls} />
            </Campo>
            <Campo label="1º vencimento">
              <DateField value={divInicio} onChange={setDivInicio} />
            </Campo>
            <div className="flex items-end">
              <button type="button" className="admin-btn w-full" onClick={dividir}>
                Dividir
              </button>
            </div>
          </div>
        </div>

        <div className="mt-2 rounded-[12px] border border-line-soft bg-cream-2 p-4">
          <p className="ledger-eyebrow">Recorrência</p>
          <p className="mt-1 mb-3 text-xs font-medium text-ledger-muted">
            Para contas que se repetem (aluguel, mensalidade), informe quantas vezes, o primeiro
            vencimento e o valor de cada vez. As parcelas são geradas mês a mês e podem ser
            ajustadas antes de gravar.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo label="Quantas vezes">
              <input
                value={recQtd}
                onChange={(e) => setRecQtd(e.target.value)}
                inputMode="numeric"
                placeholder="Ex.: 12"
                className={inputCls}
              />
            </Campo>
            <Campo label="Primeiro vencimento">
              <DateField value={recInicio} onChange={setRecInicio} />
            </Campo>
            <Campo label="Valor de cada">
              <input
                value={recValor}
                onChange={(e) => setRecValor(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className={inputCls}
              />
            </Campo>
          </div>
          <button type="button" className="admin-btn mt-3" onClick={gerarRecorrencia}>
            <Plus aria-hidden className="size-4" /> Gerar parcelas mensais
          </button>
        </div>

        <div className="mt-2 rounded-[12px] border border-line-soft bg-cream-2 p-4">
          <div className="flex items-center justify-between">
            <p className="ledger-eyebrow">Parcelas</p>
            <button
              type="button"
              className="admin-btn"
              onClick={() => setParcelas((p) => [...p, { vencimento: undefined, valor: "" }])}
            >
              <Plus aria-hidden className="size-4" /> Adicionar parcela
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {parcelas.map((p, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[10rem] flex-1">
                  <Campo label={`Vencimento ${i + 1}`}>
                    <DateField
                      value={p.vencimento}
                      onChange={(d) =>
                        setParcelas((arr) =>
                          arr.map((x, j) => (j === i ? { ...x, vencimento: d } : x)),
                        )
                      }
                    />
                  </Campo>
                </div>
                <div className="min-w-[8rem] flex-1">
                  <Campo label="Valor">
                    <input
                      value={p.valor}
                      onChange={(e) =>
                        setParcelas((arr) =>
                          arr.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)),
                        )
                      }
                      inputMode="decimal"
                      placeholder="0,00"
                      className={inputCls}
                    />
                  </Campo>
                </div>
                {parcelas.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remover parcela ${i + 1}`}
                    className="admin-btn"
                    onClick={() => setParcelas((arr) => arr.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm font-semibold text-ledger-text tabular-nums">
            Total do título: {formatBRLFromCents(total)}
          </p>
        </div>

        <div className="mt-2 rounded-[12px] border border-line-soft bg-cream-2 p-4">
          <label className="flex items-center gap-3 text-sm font-semibold text-ledger-text">
            <input type="checkbox" className="size-5 accent-[var(--color-champagne)]" checked={jaPago} onChange={(e) => setJaPago(e.target.checked)} />
            {direction === "payable" ? "Já está pago" : "Já foi recebido"}
          </label>
          {jaPago ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Campo label={direction === "payable" ? "Pago por (conta, caixa ou cartão)" : "Recebido em (conta ou caixa)"}>
                <SmartSelect
                  options={(contas.data ?? []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.nome }))}
                  value={contaBaixa}
                  onChange={setContaBaixa}
                  placeholder="Escolha a conta"
                  searchPlaceholder="Buscar conta"
                />
              </Campo>
              {ehCartao ? (
                <p className="self-end text-xs font-medium text-ledger-muted">
                  Cartão: cada parcela é lançada no cartão na data do seu vencimento, igual à fatura de cada mês.
                </p>
              ) : (
                <Campo label="Data do pagamento">
                  <DateField value={dataBaixa} onChange={setDataBaixa} />
                </Campo>
              )}
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="admin-btn" onClick={() => onOpenChange(false)}>
            Cancelar
          </button>
          <button
            type="button"
            className="admin-btn-primary"
            disabled={salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? "Gravando…" : "Gravar título"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
