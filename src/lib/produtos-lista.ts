// Lista de produtos desdobrada: uma linha por variante vendável, com saldo em estoque.

export interface LinhaSaldo {
  variant_id: string;
  quantity: number;
  reserved: number;
  locations: { kind: string } | null;
}

export interface SaldoVariante {
  /** Depósito/loja/outros (fora de maletas). */
  quantidade: number;
  reservado: number;
  disponivel: number;
  /** Peças em maletas de consultoras (informativo). */
  maletas: number;
}

/** Estoque = tudo fora de maleta; maletas ficam só no detalhe. */
export function somarEstoque(linhas: LinhaSaldo[]): Map<string, SaldoVariante> {
  const m = new Map<string, SaldoVariante>();
  for (const l of linhas) {
    const s = m.get(l.variant_id) ?? { quantidade: 0, reservado: 0, disponivel: 0, maletas: 0 };
    if (l.locations?.kind === "maleta") s.maletas += Number(l.quantity) || 0;
    else {
      s.quantidade += Number(l.quantity) || 0;
      s.reservado += Number(l.reserved) || 0;
    }
    s.disponivel = s.quantidade - s.reservado;
    m.set(l.variant_id, s);
  }
  return m;
}

interface ProdutoBase {
  id: string;
  price_cents: number | null;
}

interface VarianteBase {
  id: string;
  product_id: string;
  label: string;
  barcode: string | null;
  reference_code: string | null;
  price_cents: number | null;
  is_active: boolean;
}

/**
 * Mantém a ordem dos produtos; cada variante ativa vira uma linha.
 * Produto sem variante ativa continua com uma linha (nada some da lista).
 */
export function expandirPorVariante<P extends ProdutoBase>(produtos: P[], variantes: VarianteBase[]) {
  const porProduto = new Map<string, VarianteBase[]>();
  for (const v of variantes) {
    if (!v.is_active) continue;
    const l = porProduto.get(v.product_id) ?? [];
    l.push(v);
    porProduto.set(v.product_id, l);
  }
  return produtos.flatMap((p) => {
    const vs = porProduto.get(p.id) ?? [];
    if (vs.length === 0) {
      return [{ ...p, chave: p.id, variantId: null, variante: null, barcode: null, referencia: null, precoLinha: p.price_cents, totalVariantes: 0 }];
    }
    return vs.map((v) => ({
      ...p,
      chave: `${p.id}:${v.id}`,
      variantId: v.id as string | null,
      variante: v.label as string | null,
      barcode: v.barcode,
      referencia: v.reference_code,
      precoLinha: v.price_cents ?? p.price_cents,
      totalVariantes: vs.length,
    }));
  });
}
