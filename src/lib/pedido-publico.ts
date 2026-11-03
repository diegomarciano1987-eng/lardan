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

export const SITE_PUBLICO = "https://www.lardan.com.br";

/** Endereço completo (com https://) para mandar no WhatsApp. Fora do site oficial usa o domínio oficial. */
export function urlPublica(caminho: string, origem?: string) {
  const abs = /^(https?:\/\/[^/]+)(.*)$/i.exec(caminho);
  if (abs) return urlPublica(abs[2] || "/", abs[1]);
  const o = origem ?? (typeof window !== "undefined" ? window.location.origin : "");
  const base = /^https:\/\/([a-z0-9-]+\.)*lardan\.com\.br$/i.test(o) ? o : SITE_PUBLICO;
  return `${base}${caminho.startsWith("/") ? "" : "/"}${caminho}`;
}

/** Foto pública de uma peça, já com endereço completo. */
export const fotoPecaUrl = (mediaId: string | null | undefined, origem?: string) =>
  mediaId ? urlPublica(`/api/public/midia/${mediaId}`, origem) : null;

export const linkPedidoPublico = (token: string, origem?: string) => urlPublica(`/pedido/${token}`, origem);

export const fotoPedido = (token: string, media: string | null | undefined) =>
  media ? `/api/public/pedido-foto/${token}/${media}` : null;

/** Linha de uma peça com referência (quando houver). */
export function linhaPeca(i: { quantidade: number; nome: string; variante?: string | null; referencia?: string | null; valor_cents: number }) {
  return `• ${i.quantidade}x ${i.nome}${i.variante ? ` (${i.variante})` : ""}${i.referencia ? ` · Ref. ${i.referencia}` : ""} — ${brl(i.valor_cents)}`;
}

/** Resumo que a consultora manda à cliente: peça, variante, referência, valor e o link da página com as fotos. */
export function mensagemResumoPedido(a: {
  cliente: string;
  codigo: string;
  itens: Pick<ItemPublico, "nome" | "variante" | "quantidade" | "unitario_cents" | "referencia">[];
  total_cents: number;
  combinado?: string | null;
  link?: string | null;
  manual: string;
  /** Datas já formatadas (dd/mm/aaaa) para o comprovante completo. */
  garantiaAte?: string | null;
  trocaAte?: string | null;
}) {
  const linhas = a.itens.map((i) => linhaPeca({ ...i, valor_cents: i.unitario_cents * i.quantidade }));
  const completo = !!(a.garantiaAte || a.trocaAte);
  return [
    ...(completo ? [`Comprovante e garantia LARDAN · Pedido ${a.codigo}`, ""] : []),
    `Olá, ${a.cliente.trim().split(/\s+/)[0]}! Anotei seu pedido ${a.codigo}:`,
    ...linhas,
    `Total: ${brl(a.total_cents)}`,
    ...(a.combinado ? [`Pagamento combinado: ${a.combinado}`] : []),
    ...(a.link ? [`Fotos, comprovante e certificado de garantia: ${a.link}`] : []),
    ...(a.garantiaAte ? [`Garantia de dois anos, válida até ${a.garantiaAte}, seguindo o manual: ${a.manual}`] : [`Garantia de dois anos seguindo o manual: ${a.manual}`]),
    ...(a.trocaAte ? [`Troca até ${a.trocaAte}.`] : []),
  ].join("\n");
}
