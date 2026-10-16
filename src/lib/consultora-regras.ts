export const MANUAL_CUIDADOS_URL = "https://www.lardan.com.br/cuidados";
export const GARANTIA_ANOS = 2;

export function precoFinal90(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Preço inválido");
  return cents === 0 ? 0 : Math.ceil((cents - 90) / 100) * 100 + 90;
}

export function idadePedido(criado: string, hoje = new Date()) {
  const dia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return Math.max(0, Math.round((Date.parse(dia(hoje)) - Date.parse(dia(new Date(criado)))) / 86400000));
}
export function tomIdade(dias: number) {
  return dias <= 3 ? "success" : dias <= 7 ? "warning" : "destructive";
}
export function fimGarantia(compra: string) {
  const d = new Date(compra.slice(0, 10) + "T12:00:00Z");
  const mes = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + GARANTIA_ANOS);
  if (d.getUTCMonth() !== mes) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
export function mensagemPedido(p: { customer_name: string; code: string; status: string; subtotal_cents: number; payment_status?: string }) {
  const nome = p.customer_name.split(" ")[0];
  const total = (p.subtotal_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (p.status === "cancelado") return `Olá, ${nome}! Seu pedido ${p.code} foi cancelado. Se precisar, estou por aqui.`;
  if (p.payment_status === "pago" || p.status === "concluido") return `Olá, ${nome}! Vamos combinar a entrega do seu pedido ${p.code}?\nCuidados com suas semijoias e garantia de dois anos, seguindo o manual: ${MANUAL_CUIDADOS_URL}`;
  if (p.status === "aguardando_pagamento") return `Olá, ${nome}! Tudo bem? Passando para lembrar do seu pedido ${p.code}, de ${total}. Podemos combinar o pagamento?\nManual de cuidados: ${MANUAL_CUIDADOS_URL}`;
  return `Olá, ${nome}! Estou cuidando do seu pedido ${p.code}, de ${total}. Quer conferir as peças e combinar a entrega?\nManual de cuidados: ${MANUAL_CUIDADOS_URL}`;
}

export const CUIDADOS = [
  { titulo: "Coloque as peças por último", texto: "Vista as roupas e aplique perfumes, cremes, protetor solar e desodorante antes das semijoias. Espere os produtos secarem completamente, cerca de cinco minutos, e só então coloque as peças." },
  { titulo: "Limpe após o uso", texto: "Passe uma flanela seca e macia para retirar suor e oleosidade. Se necessário, faça uma limpeza pontual com água morna e sabão neutro, secando completamente com flanela ou secador no ar frio." },
  { titulo: "Guarde separadamente", texto: "Use saquinhos de tecido, como veludo ou suede, ou um porta-joias com divisórias. Isso evita atritos e riscos. Guarde em local seco, longe da umidade do banheiro." },
  { titulo: "Retire antes de molhar ou se exercitar", texto: "Não use no banho, na piscina ou no mar. Cloro, sal, umidade e suor podem acelerar a oxidação e o desgaste do banho metálico." },
  { titulo: "Não durma com as semijoias", texto: "O atrito com travesseiros e lençóis pode entortar ganchos, quebrar correntes finas e desgastar o brilho." },
  { titulo: "Evite cosméticos diretamente nas peças", texto: "Nunca borrife perfume nem aplique cremes sobre colares, brincos ou outras semijoias já colocadas." },
];