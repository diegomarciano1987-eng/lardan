type Forma = { id: string; nome: string; codigo?: string | null };

const normalizar = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** Evidência do banco vem antes do aprendizado; sem evidência não inventa um meio. */
export function meioDoExtrato(historico: string | null | undefined): "pix" | "transferencia" | "boleto" | null {
  const texto = normalizar(historico ?? "");
  if (/\bpix\b/.test(texto)) return "pix";
  if (/\b(ted|doc|transferencia)\b/.test(texto)) return "transferencia";
  if (/\bboleto\b/.test(texto)) return "boleto";
  return null;
}

export function sugerirFormaDoExtrato(historico: string | null | undefined, formas: Forma[], aprendida?: string | null): string {
  const meio = meioDoExtrato(historico);
  if (!meio) return formas.some((f) => f.id === aprendida) ? aprendida ?? "" : "";
  const nomes = meio === "pix" ? ["cobranca pix", "pix"]
    : meio === "transferencia" ? ["transferencia bancaria", "transferencia", "ted / doc"]
    : ["boleto bancario", "boleto"];
  return formas.find((f) => nomes.includes(normalizar(f.nome)))?.id ?? "";
}

export const alvaraConfere = (recebido: number, principal: number, jurosConfirmados: number) =>
  Number.isSafeInteger(recebido) && Number.isSafeInteger(principal) && Number.isSafeInteger(jurosConfirmados)
  && principal > 0 && jurosConfirmados >= 0 && recebido === principal + jurosConfirmados;