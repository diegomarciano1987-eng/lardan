import type { Devedor } from "@/lib/cobranca";

export type Coluna = "regua" | "negociacao" | "acordo" | "atrasado" | "judicial";
export type AcordoSit = { party_id: string; simulacao_id: string; total_cents: number; pago_cents: number; dias_atraso: number; prorrogado: boolean };

/** Coluna do Kanban: acordo com parcela vencida = atrasado (mesmo no Judicial, para bater com o card); depois Judicial; "promessa" antiga cai em negociação. */
export function colunaDoDevedor(d: Pick<Devedor, "etapa">, a?: Pick<AcordoSit, "dias_atraso">): Coluna {
  if (a && a.dias_atraso > 0) return "atrasado";
  if (d.etapa === "acompanhamento") return "judicial";
  if (a || d.etapa === "em_negociacao") return "acordo";
  if (d.etapa === "novo_atraso") return "regua";
  return "negociacao";
}
