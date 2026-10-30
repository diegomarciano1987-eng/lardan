/** Busca na composição da maleta em montagem: por bip (código de barras), nome, SKU ou referência, por partes. */
export const normalizarBusca = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function filtrarComposicao<T extends { nome: string; sku: string | null }>(
  lista: [string, T][],
  termo: string,
  codigos: Record<string, string> = {},
): [string, T][] {
  const partes = normalizarBusca(termo).split(/\s+/).filter(Boolean);
  if (!partes.length) return lista;
  return lista.filter(([id, v]) => {
    const alvo = normalizarBusca(`${v.nome} ${v.sku ?? ""} ${codigos[id] ?? ""}`);
    return partes.every((p) => alvo.includes(p));
  });
}
