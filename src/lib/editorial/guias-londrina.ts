import type { Guia } from "./tipos";
import { GUIA_RENDA_EXTRA } from "./guia-renda-extra";
import { GUIA_COMECAR_VENDER } from "./guia-comecar-vender";
import { GUIA_CONSIGNADO } from "./guia-consignado";
import { GUIA_WHATSAPP } from "./guia-whatsapp";
import { GUIA_PERGUNTAS_REVENDA } from "./guia-perguntas-revenda";
import { GUIA_COMPARATIVO_SEMIJOIAS } from "./guia-comparativo-semijoias";

export const GUIA_RENDA_EXTRA_LONDRINA: Guia = {
  ...GUIA_RENDA_EXTRA,
  path: "/renda-extra-com-vendas-em-londrina",
  slug: "renda-extra-com-vendas-em-londrina",
  title: "Renda extra com vendas em Londrina | Lardan",
  h1: "Como planejar uma renda extra com vendas em Londrina",
  description: "Em Londrina, quanto precisa sobrar de uma venda para valer a pena atravessar a cidade e entregar uma peça?",
  abertura: ["Em Londrina, quanto precisa sobrar de uma venda para valer a pena atravessar a cidade e entregar uma peça? Antes de escolher os produtos, anote o tempo disponível na semana, o custo dos deslocamentos e quanto você deseja guardar.", ...GUIA_RENDA_EXTRA.abertura],
  secoes: [
    {
      id: "orientacao-em-londrina",
      titulo: "Faça a conta de uma semana de vendas",
      blocos: [{ tipo: "paragrafo", texto: "Imagine que duas clientes pediram para ver a maleta em dias diferentes. Compare o custo de fazer duas visitas com o de combinar os atendimentos na mesma tarde. Desconte transporte, embalagem e outros gastos da comissão antes de avaliar seu resultado." }],
    },
    ...GUIA_RENDA_EXTRA.secoes,
  ],
  relacionados: [
    ...GUIA_RENDA_EXTRA.relacionados,
    { to: "/revenda-de-semijoias-em-londrina", titulo: "Revenda com a Lardan em Londrina", descricao: "Conheça a maleta e envie sua candidatura.", ctaId: "renda-extra-com-vendas_londrina_revenda" },
  ],
  publicadoEm: "2026-11-25",
  atualizadoEm: "2026-11-25",
};

export const GUIA_COMECAR_VENDER_LONDRINA: Guia = {
  ...GUIA_COMECAR_VENDER,
  path: "/como-comecar-a-vender-semijoias-em-londrina",
  slug: "como-comecar-a-vender-semijoias-em-londrina",
  title: "Como começar a vender semijoias em Londrina | Lardan",
  h1: "Como começar a vender semijoias em Londrina",
  description: "Para fazer sua primeira apresentação de semijoias em Londrina, comece com uma conversa.",
  abertura: ["Para fazer sua primeira apresentação de semijoias em Londrina, comece com uma conversa. Pergunte a uma cliente em potencial se ela prefere peças discretas ou marcantes e quanto costuma gastar em um presente. As respostas ajudam a escolher o que levar.", ...GUIA_COMECAR_VENDER.abertura],
  secoes: [
    {
      id: "orientacao-em-londrina",
      titulo: "Prepare a primeira apresentação",
      blocos: [{ tipo: "paragrafo", texto: "Separe três opções de estilos ou valores diferentes. Mostre cada peça com o respectivo preço, explique os cuidados e registre qual delas despertou interesse. Se a cliente quiser pensar, combine quando poderá voltar a falar com ela." }],
    },
    ...GUIA_COMECAR_VENDER.secoes,
  ],
  relacionados: [
    ...GUIA_COMECAR_VENDER.relacionados,
    { to: "/revenda-de-semijoias-em-londrina", titulo: "Revenda com a Lardan em Londrina", descricao: "Conheça a maleta e envie sua candidatura.", ctaId: "como-comecar-a-vender-semijoias_londrina_revenda" },
  ],
  publicadoEm: "2026-11-25",
  atualizadoEm: "2026-11-25",
};

export const GUIA_CONSIGNADO_LONDRINA: Guia = {
  ...GUIA_CONSIGNADO,
  path: "/semijoias-consignadas-para-revenda-em-londrina",
  slug: "semijoias-consignadas-para-revenda-em-londrina",
  title: "Semijoias consignadas para revenda em Londrina | Lardan",
  h1: "Semijoias consignadas para revenda em Londrina",
  description: "Se você procura uma maleta de semijoias consignadas para revender em Londrina, peça as condições por escrito.",
  abertura: ["Se você procura uma maleta de semijoias consignadas para revender em Londrina, peça as condições por escrito. Quem entrega a maleta? Quando acontece o acerto? Como registrar uma peça devolvida? Essas respostas ajudam a comparar propostas.", ...GUIA_CONSIGNADO.abertura],
  secoes: [
    {
      id: "orientacao-em-londrina",
      titulo: "O que conferir ao receber a maleta",
      blocos: [{ tipo: "paragrafo", texto: "Conte as peças junto com a relação recebida. Confira referência, quantidade e estado de conservação antes de confirmar o recebimento. Guarde essa relação para comparar as vendas e as devoluções no primeiro acerto." }],
    },
    ...GUIA_CONSIGNADO.secoes,
  ],
  relacionados: [
    ...GUIA_CONSIGNADO.relacionados,
    { to: "/revenda-de-semijoias-em-londrina", titulo: "Revenda com a Lardan em Londrina", descricao: "Conheça a maleta e envie sua candidatura.", ctaId: "semijoias-consignadas-para-revenda_londrina_revenda" },
  ],
  publicadoEm: "2026-11-25",
  atualizadoEm: "2026-11-25",
};

export const GUIA_WHATSAPP_LONDRINA: Guia = {
  ...GUIA_WHATSAPP,
  path: "/como-vender-semijoias-pelo-whatsapp-em-londrina",
  slug: "como-vender-semijoias-pelo-whatsapp-em-londrina",
  title: "Como vender semijoias pelo WhatsApp em Londrina | Lardan",
  h1: "Como vender semijoias pelo WhatsApp em Londrina",
  description: "Quem vende semijoias pelo WhatsApp em Londrina pode combinar a escolha da peça pelo celular e os detalhes do atendimento em uma única conversa.",
  abertura: ["Quem vende semijoias pelo WhatsApp em Londrina pode combinar a escolha da peça pelo celular e os detalhes do atendimento em uma única conversa. Comece perguntando a ocasião, a faixa de preço e se a cliente deseja receber fotos.", ...GUIA_WHATSAPP.abertura],
  secoes: [
    {
      id: "orientacao-em-londrina",
      titulo: "Uma mensagem para combinar o atendimento",
      blocos: [{ tipo: "paragrafo", texto: "“Oi, Ana! Separei os dois brincos dourados que você pediu. Quer ver uma foto de cada um na orelha para comparar o tamanho? Se gostar de algum, me diga em que região de Londrina você está e eu confirmo as opções de entrega.” Use essa última frase apenas quando você puder verificar a entrega." }],
    },
    ...GUIA_WHATSAPP.secoes,
  ],
  relacionados: [
    ...GUIA_WHATSAPP.relacionados,
    { to: "/revenda-de-semijoias-em-londrina", titulo: "Revenda com a Lardan em Londrina", descricao: "Conheça a maleta e envie sua candidatura.", ctaId: "como-vender-semijoias-pelo-whatsapp_londrina_revenda" },
  ],
  publicadoEm: "2026-11-25",
  atualizadoEm: "2026-11-25",
};

export const GUIA_PERGUNTAS_REVENDA_LONDRINA: Guia = {
  ...GUIA_PERGUNTAS_REVENDA,
  path: "/perguntas-sobre-revenda-de-semijoias-em-londrina",
  slug: "perguntas-sobre-revenda-de-semijoias-em-londrina",
  title: "Dúvidas sobre revenda de semijoias em Londrina | Lardan",
  h1: "Perguntas sobre revenda de semijoias em Londrina",
  description: "Quem pensa em revender semijoias em Londrina costuma precisar de respostas para tomar uma decisão prática.",
  abertura: ["Quem pensa em revender semijoias em Londrina costuma precisar de respostas para tomar uma decisão prática. Preciso comprar estoque? Como funciona o cadastro? Com quem esclareço uma divergência na maleta? Use as perguntas deste guia ao conversar com a equipe.", ...GUIA_PERGUNTAS_REVENDA.abertura],
  secoes: [
    {
      id: "orientacao-em-londrina",
      titulo: "Moro fora de Londrina. Onde encontro a página da minha cidade?",
      blocos: [{ tipo: "paragrafo", texto: "A Lardan também tem páginas de revenda para Ibiporã, Cambé, Rolândia, Arapongas e Apucarana. Consulte a página do seu município e confirme com a equipe as condições de atendimento para o seu endereço." }],
    },
    ...GUIA_PERGUNTAS_REVENDA.secoes,
  ],
  relacionados: [
    ...GUIA_PERGUNTAS_REVENDA.relacionados,
    { to: "/revenda-de-semijoias-em-londrina", titulo: "Revenda com a Lardan em Londrina", descricao: "Conheça a maleta e envie sua candidatura.", ctaId: "perguntas-sobre-revenda-de-semijoias_londrina_revenda" },
  ],
  publicadoEm: "2026-11-25",
  atualizadoEm: "2026-11-25",
};

export const GUIA_COMPARATIVO_SEMIJOIAS_LONDRINA: Guia = {
  ...GUIA_COMPARATIVO_SEMIJOIAS,
  path: "/guia/semijoia-folheado-ou-bijuteria-em-londrina",
  slug: "guia-semijoia-folheado-ou-bijuteria-em-londrina",
  title: "Semijoia, folheado ou bijuteria em Londrina | Lardan",
  h1: "Semijoia, folheado ou bijuteria em Londrina? O que comparar antes de comprar",
  description: "Ao comparar acessórios em Londrina, duas peças douradas podem parecer iguais na vitrine.",
  abertura: ["Ao comparar acessórios em Londrina, duas peças douradas podem parecer iguais na vitrine. Antes de escolher, pergunte qual é a base, qual acabamento foi aplicado e quais cuidados a marca recomenda. O nome da categoria sozinho diz pouco sobre a peça.", ...GUIA_COMPARATIVO_SEMIJOIAS.abertura],
  secoes: [
    {
      id: "orientacao-em-londrina",
      titulo: "Como comparar duas peças na hora da escolha",
      blocos: [{ tipo: "paragrafo", texto: "Imagine dois pares de argolas com aparência semelhante. Compare o fechamento, o acabamento interno, a descrição do banho e as condições de garantia. Se for um presente, pergunte também quais informações de conservação acompanham a peça." }],
    },
    ...GUIA_COMPARATIVO_SEMIJOIAS.secoes,
  ],
  relacionados: [
    ...GUIA_COMPARATIVO_SEMIJOIAS.relacionados,
    { to: "/revenda-de-semijoias-em-londrina", titulo: "Revenda com a Lardan em Londrina", descricao: "Conheça a maleta e envie sua candidatura.", ctaId: "semijoia-folheado-ou-bijuteria_londrina_revenda" },
  ],
  publicadoEm: "2026-11-25",
  atualizadoEm: "2026-11-25",
};

export const GUIAS_LONDRINA = [
  GUIA_RENDA_EXTRA_LONDRINA,
  GUIA_COMECAR_VENDER_LONDRINA,
  GUIA_CONSIGNADO_LONDRINA,
  GUIA_WHATSAPP_LONDRINA,
  GUIA_PERGUNTAS_REVENDA_LONDRINA,
  GUIA_COMPARATIVO_SEMIJOIAS_LONDRINA,
];
