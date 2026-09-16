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
import {
  buscarContrapartes,
  criarTitulo,
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

interface ParcelaForm {
  vencimento: Date | undefined;
  valor: string;
}

/** Cadastro de título a pagar ou a receber, com parcelas conferidas no servidor. */
export function NovoTituloDialog({
  open,
  onOpenChange,
  direction,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  direction: FinDirection;
}) {
  const qc = useQueryClient();
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

  React.useEffect(() => {
    if (!open) {
      setParty("");
      setDescricao("");
      setDocumento("");
      setObservacao("");
      setClassificacao(CLASSIFICACAO_VAZIA);
      setParcelas([{ vencimento: undefined, valor: "" }]);
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
      return criarTitulo({
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
        ...(classificacao.cost_center_id
          ? { cost_center_id: classificacao.cost_center_id }
          : {}),
        ...(classificacao.payment_method_id
          ? { payment_method_id: classificacao.payment_method_id }
          : {}),
        ...(classificacao.financial_account_id
          ? { financial_account_id: classificacao.financial_account_id }
          : {}),
        valor_cents: linhas.reduce((s, l) => s + l.valor_cents, 0),
        parcelas: linhas,
      });
    },
    onSuccess: () => {
      toast.success("Título registrado.");
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
