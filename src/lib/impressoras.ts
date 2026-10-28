export type DestinoImpressao = "a4" | "etiquetas";
export const IMPRESSORAS_KEY = "lardan.impressoras.estacao.v1";
export interface ImpressorasEstacao { a4: string; etiquetas: string }
export const IMPRESSORAS_VAZIAS: ImpressorasEstacao = { a4: "", etiquetas: "" };
export function normalizarImpressoras(valor: unknown): ImpressorasEstacao {
  const v = valor && typeof valor === "object" ? valor as Record<string, unknown> : {};
  const nome = (k: string) => typeof v[k] === "string" ? v[k].trim().slice(0, 160) : "";
  return { a4: nome("a4"), etiquetas: nome("etiquetas") };
}
export function lerImpressoras(): ImpressorasEstacao {
  try { return normalizarImpressoras(JSON.parse(localStorage.getItem(IMPRESSORAS_KEY) ?? "null")); }
  catch { return { ...IMPRESSORAS_VAZIAS }; }
}
export function salvarImpressoras(v: ImpressorasEstacao) {
  localStorage.setItem(IMPRESSORAS_KEY, JSON.stringify(normalizarImpressoras(v)));
}
export const destinoDocumento = (tipo: "pedido" | "romaneio" | "promissoria" | "etiqueta"): DestinoImpressao => tipo === "etiqueta" ? "etiquetas" : "a4";