/** Cobrança histórica (dívidas vencidas até o corte): quem pode receber fatura única e por quê. */
export type DevedorHistorico = {
  party_id: string;
  nome: string | null;
  codigo: string | null;
  parcelas: number;
  saldo_cents: number;
  venc_min: string;
  venc_max: string;
  installment_ids: string[];
  tem_recente: boolean;
  judicial: boolean;
  asaas_abertas: number;
  acordo_id: string | null;
  acordo_origem: "acordo" | "historica" | null;
};

export type SituacaoHistorica = { tipo: "apta" | "judicial" | "faturada" | "acordo" | "asaas"; rotulo: string };

/** Mesma ordem de prioridade do banco (cob_historica_consolidar). */
export function situacaoHistorica(d: DevedorHistorico): SituacaoHistorica {
  if (d.judicial) return { tipo: "judicial", rotulo: "No Judicial (fica com o jurídico)" };
  if (d.acordo_id) return d.acordo_origem === "historica"
    ? { tipo: "faturada", rotulo: "Já tem fatura única" }
    : { tipo: "acordo", rotulo: "Já tem acordo ativo" };
  if (d.asaas_abertas > 0) return { tipo: "asaas", rotulo: `${d.asaas_abertas} cobrança(s) aberta(s) no Asaas — cancelar antes` };
  return { tipo: "apta", rotulo: "Pronta para fatura única" };
}

/** Só com dívida antiga (nada vencendo depois do corte): sai da Régua Asaas e fica na Cobrança histórica. */
export const soHistorica = (d: Pick<DevedorHistorico, "tem_recente">) => !d.tem_recente;
