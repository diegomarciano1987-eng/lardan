/* ============================================================
 * FINANCEIRO DA FAMÍLIA — datas sem fuso (yyyy-MM / yyyy-MM-dd)
 * Cópia própria do módulo: não depende de outras libs da Lardan.
 * ============================================================ */
const pad2 = (n: number) => String(n).padStart(2, "0");
const YM_RE = /^(\d{4})-(\d{2})/;
const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Dias do mês (mês 1 a 12). */
export function ultimoDiaDoMes(ano: number, mes1a12: number): number {
  return new Date(ano, mes1a12, 0).getDate();
}

/** "yyyy-MM-dd" do dia de hoje no horário local. */
export function hojeISO(agora: Date = new Date()): string {
  return `${agora.getFullYear()}-${pad2(agora.getMonth() + 1)}-${pad2(agora.getDate())}`;
}

/** "yyyy-MM" de uma data local. */
export function toISOMonth(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function partesYM(ym: string): [number, number] {
  const m = YM_RE.exec(ym);
  if (!m) throw new Error(`Mês inválido: ${ym}`);
  return [Number(m[1]), Number(m[2])];
}

/** Soma meses a "yyyy-MM". */
export function addMonthsYM(ym: string, meses: number): string {
  const [y, m] = partesYM(ym);
  const alvo = y * 12 + (m - 1) + meses;
  const ny = Math.floor(alvo / 12);
  return `${ny}-${pad2(alvo - ny * 12 + 1)}`;
}

/** Diferença em meses entre dois "yyyy-MM" (b - a). */
export function diffMonthsYM(a: string, b: string): number {
  const [ay, am] = partesYM(a);
  const [by, bm] = partesYM(b);
  return (by * 12 + bm) - (ay * 12 + am);
}

/** Primeiro e último dia de um "yyyy-MM". */
export function limitesDoMes(ym: string): { de: string; ate: string } {
  const [y, m] = partesYM(ym);
  return { de: `${y}-${pad2(m)}-01`, ate: `${y}-${pad2(m)}-${pad2(ultimoDiaDoMes(y, m))}` };
}

/** "yyyy-MM-dd" → "dd/MM/yyyy" sem passar por Date. */
export function formatISODateBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = DATA_RE.exec(iso);
  if (!m) return "—";
  return `${m[3]}/${m[2]}/${m[1]}`;
}
