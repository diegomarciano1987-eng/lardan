/**
 * Leitura segura de planilhas (cliente e servidor).
 *
 * Regras inegociáveis:
 * - todo valor é lido como texto: SKU, EAN e código legado nunca perdem zeros
 *   à esquerda nem viram notação científica;
 * - limites explícitos de tamanho, linhas, colunas e célula;
 * - fórmulas e macros nunca são executadas (a biblioteca lê apenas valores);
 * - a biblioteca de leitura é carregada sob demanda, só quando a importação abre.
 */

export const LIMITES = {
  bytes: 20 * 1024 * 1024,
  linhas: 50_000,
  colunas: 120,
  celula: 5_000,
} as const;

export const PARSER_VERSION = "lardan-xlsx-2";

export interface PlanilhaLida {
  cabecalhos: string[];
  linhas: Record<string, string>[];
  avisos: string[];
  planilhas: string[];
}

export type Matriz = string[][];

function limpar(valor: unknown): string {
  const s = String(valor ?? "").trim();
  return s.length > LIMITES.celula ? s.slice(0, LIMITES.celula) : s;
}

/** Lê a planilha inteira preservando texto. Lança erro com linguagem de gente. */
export async function lerPlanilha(buffer: ArrayBuffer): Promise<PlanilhaLida> {
  if (buffer.byteLength > LIMITES.bytes) {
    throw new Error(
      `Arquivo grande demais (${(buffer.byteLength / 1048576).toFixed(1)} MB). O limite é 20 MB.`,
    );
  }
  const XLSX = await import("xlsx");
  let wb: import("xlsx").WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "array", raw: false, cellDates: false, cellFormula: false });
  } catch {
    throw new Error("Não consegui abrir este arquivo. Ele pode estar corrompido ou protegido por senha.");
  }
  const avisos: string[] = [];
  if (wb.SheetNames.length > 1) {
    avisos.push(
      `O arquivo tem ${wb.SheetNames.length} abas. Foi lida apenas a primeira ("${wb.SheetNames[0]}").`,
    );
  }
  const nome = wb.SheetNames[0];
  const sheet = nome ? wb.Sheets[nome] : undefined;
  if (!sheet) return { cabecalhos: [], linhas: [], avisos, planilhas: wb.SheetNames };

  const matriz = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  const cabecalhosBrutos = (matriz[0] ?? []).map(limpar);
  if (cabecalhosBrutos.length > LIMITES.colunas) {
    throw new Error(`A planilha tem ${cabecalhosBrutos.length} colunas. O limite é ${LIMITES.colunas}.`);
  }
  const vistos = new Set<string>();
  const cabecalhos = cabecalhosBrutos.map((c, i) => {
    if (!c) return "";
    let nomeCol = c;
    let n = 2;
    while (vistos.has(nomeCol)) nomeCol = `${c} (${n++})`;
    vistos.add(nomeCol);
    if (nomeCol !== c) avisos.push(`A coluna "${c}" aparece mais de uma vez (posição ${i + 1}).`);
    return nomeCol;
  });

  const linhas: Record<string, string>[] = [];
  for (let i = 1; i < matriz.length; i += 1) {
    if (linhas.length >= LIMITES.linhas) {
      throw new Error(`A planilha passa de ${LIMITES.linhas.toLocaleString("pt-BR")} linhas. Divida o arquivo.`);
    }
    const bruta = matriz[i] ?? [];
    const registro: Record<string, string> = {};
    let vazia = true;
    cabecalhos.forEach((cab, idx) => {
      if (!cab) return;
      const valor = limpar(bruta[idx]);
      registro[cab] = valor;
      if (valor !== "") vazia = false;
    });
    if (!vazia) linhas.push(registro);
  }
  return { cabecalhos: cabecalhos.filter(Boolean), linhas, avisos, planilhas: wb.SheetNames };
}

/** Célula segura para exportação: nunca vira fórmula ao abrir no Excel. */
export function celulaSegura(valor: unknown): string {
  const s = String(valor ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
