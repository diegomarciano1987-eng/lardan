/** Cálculo de encargos e acordo — puro, em centavos, sem efeito financeiro. */
export interface ParcelaCalc { installment_id: string; vencimento: string; saldo_cents: number }
export interface Encargos { multa_pct: number; juros_mes_pct: number; carencia_dias: number }
export interface LinhaCalc { installment_id: string; vencimento: string; dias: number; principal: number; multa: number; juros: number; total: number }

const dia = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const diasEntre = (de: string, ate: string) => Math.round((dia(ate) - dia(de)) / 86_400_000);

/** Multa única + juros simples pro rata dia (juros ao mês / 30), só após a carência. */
export function calcularEncargos(parcelas: ParcelaCalc[], dataBase: string, cfg: Encargos, aplicar = true): LinhaCalc[] {
  return parcelas.map((p) => {
    const dias = Math.max(0, diasEntre(p.vencimento, dataBase));
    const cobra = aplicar && dias > cfg.carencia_dias;
    const multa = cobra ? Math.round((p.saldo_cents * cfg.multa_pct) / 100) : 0;
    const juros = cobra ? Math.round((p.saldo_cents * cfg.juros_mes_pct * dias) / 3000) : 0;
    return { installment_id: p.installment_id, vencimento: p.vencimento, dias, principal: p.saldo_cents, multa, juros, total: p.saldo_cents + multa + juros };
  });
}

export function addMeses(d: string, n: number) {
  const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
  const alvo = new Date(Date.UTC(y, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(dd, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** Divide (total − entrada) em n parcelas mensais; a última absorve o arredondamento. */
export function montarPlano(total: number, entrada: number, n: number, primeira: string) {
  const resto = Math.max(0, total - entrada);
  const base = Math.floor(resto / n);
  return Array.from({ length: n }, (_, i) => ({ numero: i + 1, data: addMeses(primeira, i), valor_cents: i === n - 1 ? resto - base * (n - 1) : base }));
}
