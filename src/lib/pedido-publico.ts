import { brl } from "@/lib/maletas";

export type ItemPublico = {
  nome: string;
  variante: string | null;
  quantidade: number;
  unitario_cents: number;
  referencia: string | null;
  media_id: string | null;
};
export type PedidoPublico = {
  codigo: string;
  criado_em: string;
  cliente: string;
  consultora: string | null;
  total_cents: number;
  itens: ItemPublico[];
};

export const fotoPedido = (token: string, media: string | null | undefined) =>
  media ? `/api/public/pedido-foto/${token}/${media}` : null;

/** Resumo que a consultora manda à cliente: peça, variante, referência, valor e o link da página com as fotos. */
export function mensagemResumoPedido(a: {
  cliente: string;
  codigo: string;
  itens: Pick<ItemPublico, "nome" | "variante" | "quantidade" | "unitario_cents" | "referencia">[];
  total_cents: number;
  combinado?: string | null;
  link?: string | null;
  manual: string;
}) {
  const linhas = a.itens.map((i) =>
    `• ${i.quantidade}x ${i.nome}${i.variante ? ` (${i.variante})` : ""}${i.referencia ? ` · Ref. ${i.referencia}` : ""} — ${brl(i.unitario_cents * i.quantidade)}`);
  return [
    `Olá, ${a.cliente.trim().split(/\s+/)[0]}! Anotei seu pedido ${a.codigo}:`,
    ...linhas,
    `Total: ${brl(a.total_cents)}`,
    ...(a.combinado ? [`Pagamento combinado: ${a.combinado}`] : []),
    ...(a.link ? [`Veja as fotos das suas peças: ${a.link}`] : []),
    `Garantia de dois anos seguindo o manual: ${a.manual}`,
  ].join("\n");
}
