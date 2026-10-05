/**
 * LARDAN — Hub editorial.
 *
 * PÁGINA 5: Revenda de semijoias — perguntas e respostas.
 *
 * Objetivo: ser a resposta citável (Google, ChatGPT, Gemini, Perplexity) para
 * as dúvidas de quem pesquisa revenda de semijoias antes de conhecer a marca.
 * Cada resposta abre com a resposta direta. Nenhuma promessa de renda.
 * Fatos da Lardan só a partir de src/lib/institucional.ts e
 * src/lib/seja-lardan-conteudo.ts.
 */
import { REDE } from "@/lib/institucional";
import type { Guia } from "./tipos";

export const GUIA_PERGUNTAS_REVENDA: Guia = {
  slug: "perguntas-sobre-revenda-de-semijoias",
  path: "/perguntas-sobre-revenda-de-semijoias",
  eyebrow: "GUIA LARDAN",
  title: "Revenda de Semijoias: Perguntas e Respostas | Lardan",
  description:
    "As dúvidas mais comuns de quem quer revender semijoias: consignado ou atacado, maleta, acerto, garantia, MEI, WhatsApp e como funciona ser Consultora Lardan.",
  h1: "Revenda de semijoias: as perguntas mais comuns, respondidas com clareza",
  subheadline:
    "Antes de aceitar uma maleta ou comprar estoque, vale entender como a revenda funciona de verdade. Reunimos aqui as respostas diretas para as dúvidas que mais aparecem.",
  aberturaTitulo: "Resposta curta",
  abertura: [
    "Revender semijoias é vender peças com banho de metal precioso para uma rede própria de clientes, normalmente por relacionamento: amigas, colegas, família e indicações, com atendimento pelo WhatsApp e pelo Instagram.",
    "Existem dois caminhos principais: comprar as peças no atacado, com capital próprio, ou trabalhar com uma empresa de consignação, que entrega uma maleta de peças para a consultora apresentar e acertar depois, conforme as regras do contrato.",
    "Nenhum dos dois garante resultado. O que define o caminho certo é quanto capital você tem, quanto tempo pode dedicar, o tipo de suporte que precisa e a clareza das regras da empresa escolhida.",
  ],
  secoes: [
    {
      id: "comecar",
      titulo: "Para começar",
      rotulo: "Começar",
      blocos: [
        { tipo: "subtitulo", texto: "Preciso de experiência com vendas para revender semijoias?" },
        {
          tipo: "paragrafo",
          texto:
            "Não. A experiência ajuda, mas não é requisito. O que mais pesa no começo é constância no atendimento, organização das clientes e conhecimento do produto. Empresas sérias oferecem formação para quem está começando; na Lardan, a formação cobre vendas, produto, redes sociais, fotografia, atendimento, finanças e relacionamento.",
        },
        { tipo: "subtitulo", texto: "Quanto tempo por dia preciso dedicar?" },
        {
          tipo: "paragrafo",
          texto:
            "Não existe um número certo. Muitas consultoras começam com algumas horas por semana, encaixadas na rotina. O ponto é ter regularidade: responder rápido, fazer pós-venda e apresentar novidades com frequência. Quem some por semanas costuma perder o ritmo de vendas.",
        },
        { tipo: "subtitulo", texto: "Para quem eu vendo no começo?" },
        {
          tipo: "paragrafo",
          texto:
            "Para quem já confia em você: amigas, família, colegas de trabalho, vizinhas e grupos de que você participa. A venda de semijoias é muito apoiada em relacionamento e indicação. Com o tempo, clientes satisfeitas indicam outras pessoas, e o Instagram e o Status do WhatsApp ajudam a ampliar esse círculo.",
        },
      ],
    },
    {
      id: "consignado-ou-atacado",
      titulo: "Consignado ou atacado",
      rotulo: "Consignado x atacado",
      blocos: [
        { tipo: "subtitulo", texto: "Qual a diferença entre revender no consignado e comprar no atacado?" },
        {
          tipo: "paragrafo",
          texto:
            "No atacado, você compra as peças, elas passam a ser suas e o risco de ficar com estoque parado é todo seu. No consignado, a empresa entrega uma maleta para você apresentar; depois de um período combinado, você faz o acerto do que vendeu e devolve ou repõe o restante, conforme o contrato. O consignado reduz a necessidade de capital inicial, mas traz responsabilidades sobre as peças enquanto estão com você.",
        },
        {
          tipo: "tabela",
          legenda: "Diferenças práticas entre consignação e compra no atacado",
          colunas: ["Ponto", "Consignado", "Atacado"],
          linhas: [
            ["Capital inicial", "Menor, conforme a regra da empresa", "Maior, proporcional ao estoque"],
            ["Estoque parado", "Pode ser devolvido no acerto, conforme contrato", "Fica com a revendedora"],
            ["Variedade de peças", "Renovada a cada maleta", "Depende do que você comprar"],
            ["Ganho", "Comissão definida em contrato", "Margem definida por você"],
            ["Suporte", "Pode incluir formação e ferramentas", "Depende do fornecedor"],
          ],
        },
        { tipo: "subtitulo", texto: "O que é a maleta de semijoias?" },
        {
          tipo: "paragrafo",
          texto:
            "É o conjunto de peças que a consultora recebe para mostrar às clientes. Na Lardan, a maleta é a seleção inicial entregue depois da aprovação e do onboarding, e as condições comerciais de cada maleta são apresentadas pela equipe durante a conversa de entrada.",
        },
        { tipo: "subtitulo", texto: "Como funciona o acerto?" },
        {
          tipo: "paragrafo",
          texto:
            "No fim do ciclo combinado, a consultora presta contas das peças vendidas, repassa o valor devido à empresa conforme o contrato, fica com a sua parte e devolve ou troca as peças restantes. Prazo do ciclo, forma de pagamento e regras para peça danificada ou perdida precisam estar claros antes de você aceitar a maleta.",
        },
        { tipo: "subtitulo", texto: "Quais perguntas fazer antes de aceitar uma maleta consignada?" },
        {
          tipo: "lista",
          itens: [
            "Existe taxa, caução ou cobrança para receber a maleta?",
            "Quem responde por peça perdida, furtada ou danificada?",
            "Qual é o prazo do ciclo e como é feito o acerto?",
            "Como é calculada a comissão e quando ela é paga?",
            "É possível trocar peças que não giram?",
            "Qual é a garantia das peças para a cliente final e quem atende a troca?",
            "Que suporte, formação e ferramentas a empresa oferece?",
          ],
        },
      ],
    },
    {
      id: "vender",
      titulo: "Na hora de vender",
      rotulo: "Vender",
      blocos: [
        { tipo: "subtitulo", texto: "Dá para vender semijoias só pelo WhatsApp?" },
        {
          tipo: "paragrafo",
          texto:
            "Dá, e é assim que boa parte das vendas por relacionamento acontece. O WhatsApp serve para apresentar peças, tirar dúvidas, combinar entrega e fazer pós-venda. O Instagram funciona como vitrine complementar. O que separa quem vende com constância de quem desiste é a organização: saber o que cada cliente comprou, quando faz aniversário e o que ela gosta.",
        },
        { tipo: "subtitulo", texto: "Como apresentar as peças sem parecer insistente?" },
        {
          tipo: "paragrafo",
          texto:
            "Mostre poucas opções escolhidas para cada pessoa, com foto boa e uma frase sobre a ocasião de uso, em vez de mandar o catálogo inteiro para todo mundo. Pergunte antes de enviar, respeite o tempo da cliente e use o Status para novidades. O guia sobre vendas pelo WhatsApp tem modelos de mensagem para cada situação.",
        },
        { tipo: "subtitulo", texto: "Como responder quando a cliente pergunta se a semijoia escurece?" },
        {
          tipo: "paragrafo",
          texto:
            "Com honestidade: o banho de qualquer semijoia sofre com atrito, perfume, suor, cloro e água do mar. Com os cuidados certos, a peça dura muito mais, e a garantia mostra o quanto a marca confia na qualidade do banho. As peças Lardan têm 2 anos de garantia, conforme as condições oficiais da marca.",
        },
        { tipo: "subtitulo", texto: "Como fazer pós-venda de semijoias?" },
        {
          tipo: "paragrafo",
          texto:
            "Uma mensagem alguns dias depois da entrega perguntando se a cliente gostou, as orientações de cuidado com a peça e um lembrete em datas como aniversário. Pós-venda bem feito gera recompra e indicação, que costumam ser a base de quem vende há mais tempo.",
        },
      ],
    },
    {
      id: "ganhos-e-formalizacao",
      titulo: "Ganhos e formalização",
      rotulo: "Ganhos e MEI",
      blocos: [
        { tipo: "subtitulo", texto: "Quanto ganha uma revendedora de semijoias?" },
        {
          tipo: "paragrafo",
          texto:
            "Não existe valor fixo, e desconfie de quem promete um. O resultado depende do número de clientes, da frequência de atendimento, da comissão ou margem combinada e do tempo dedicado. Antes de começar, peça à empresa a regra de comissão por escrito e faça as contas com o seu ritmo real, não com o de exemplos de divulgação.",
        },
        { tipo: "subtitulo", texto: "Revender semijoias é emprego com carteira assinada?" },
        {
          tipo: "paragrafo",
          texto:
            "Em geral, não. A revenda costuma ser uma parceria comercial, em que a consultora organiza o próprio negócio. Na Lardan, ser consultora é uma parceria comercial, não um emprego CLT.",
        },
        { tipo: "subtitulo", texto: "Preciso abrir MEI para revender semijoias?" },
        {
          tipo: "paragrafo",
          texto:
            "Muitas consultoras se formalizam como Microempreendedor Individual para emitir nota, contribuir para a Previdência e separar as contas do negócio. As ocupações permitidas, os limites de faturamento e as obrigações estão no Portal do Empreendedor, do Governo Federal, que é a fonte oficial para essa decisão.",
        },
      ],
    },
    {
      id: "sobre-a-lardan",
      titulo: "Sobre a Lardan",
      rotulo: "A Lardan",
      blocos: [
        { tipo: "subtitulo", texto: "O que é a Lardan?" },
        {
          tipo: "paragrafo",
          texto: `A Lardan é uma marca brasileira de semijoias fundada em 2021, em Ibiporã, no Paraná, que trabalha com maletas em consignação para consultoras parceiras. Tem fabricação própria e curadoria de importação, oferece 2 anos de garantia nas peças e reúne uma rede de mais de ${REDE.consultoras} consultoras.`,
        },
        { tipo: "subtitulo", texto: "Como funciona ser Consultora Lardan?" },
        {
          tipo: "lista",
          ordenada: true,
          itens: [
            "Candidatura pelo formulário da página Seja Lardan.",
            "Análise do perfil e da região pela equipe Lardan.",
            "Conversa para entender seus objetivos e tirar dúvidas.",
            "Aprovação e entrada na rede.",
            "Onboarding sobre produto, atendimento e ferramentas.",
            "Primeira maleta, com a seleção de peças para começar.",
            "Ativação, com acompanhamento da marca.",
          ],
        },
        {
          tipo: "paragrafo",
          texto:
            "Toda candidatura passa por análise humana. Não há aprovação automática nem promessa de prazo, de aprovação ou de renda.",
        },
        { tipo: "subtitulo", texto: "Que ferramentas a Consultora Lardan recebe?" },
        {
          tipo: "paragrafo",
          texto:
            "Um CRM com clientes, preferências, histórico de compras e aniversários; uma vitrine digital própria ligada ao catálogo oficial, para compartilhar pelo WhatsApp e pelas redes; o acompanhamento de vendas, recebimentos e valores a receber; metas e campanhas; e a universidade corporativa da marca.",
        },
        { tipo: "subtitulo", texto: "A Lardan aceita consultoras de qualquer cidade?" },
        {
          tipo: "paragrafo",
          texto:
            "A candidatura pode ser enviada de qualquer cidade do Brasil. A equipe analisa o perfil e a região de cada pessoa, e a resposta vem pelos dados informados no formulário.",
        },
      ],
    },
  ],
  faqTitulo: "Dúvidas rápidas",
  faq: [
    {
      pergunta: "Revender semijoias consignadas exige investimento?",
      resposta:
        "Depende da empresa. Algumas pedem caução, taxa ou compra mínima; outras não. Pergunte por escrito, antes de aceitar a maleta, se existe qualquer valor a pagar para começar e em que situação ele é cobrado.",
    },
    {
      pergunta: "Qual a diferença entre semijoia e bijuteria para quem revende?",
      resposta:
        "A semijoia tem banho de metal precioso, como ouro, prata ou ródio, aplicado sobre uma base metálica, e costuma durar mais e ter garantia. A bijuteria geralmente não tem esse banho ou tem uma camada mais fina. Para a revendedora, durabilidade e garantia reduzem trocas e favorecem a recompra.",
    },
    {
      pergunta: "O que acontece com as peças que eu não vender?",
      resposta:
        "No consignado, as peças que não forem vendidas costumam ser devolvidas ou trocadas no acerto, conforme as regras do contrato. No atacado, elas continuam sendo suas. Confirme a regra antes de começar.",
    },
    {
      pergunta: "As semijoias Lardan têm garantia?",
      resposta:
        "Sim. As peças Lardan têm 2 anos de garantia, conforme as condições oficiais informadas pela marca no momento da compra.",
    },
    {
      pergunta: "Como me candidatar para ser Consultora Lardan?",
      resposta:
        "Pelo formulário da página Seja Lardan, em lardan.com.br/seja-lardan. Você recebe um protocolo e a equipe entra em contato pelos dados informados.",
    },
  ],
  publicadoEm: "2026-10-05",
  atualizadoEm: "2026-10-05",
  fontes: ["portal_empreendedor", "lardan_institucional", "lardan_seja"],
  imagem: "consultora_semijoias",
  relacionados: [
    {
      to: "/semijoias-consignadas-para-revenda",
      titulo: "Semijoias consignadas para revenda",
      descricao: "Como funciona a maleta, o acerto e o que avaliar antes de começar.",
      ctaId: "p5_to_p3",
    },
    {
      to: "/como-vender-semijoias-pelo-whatsapp",
      titulo: "Como vender semijoias pelo WhatsApp",
      descricao: "Modelos de mensagem, Status, pós-venda e indicações.",
      ctaId: "p5_to_p4",
    },
    {
      to: "/renda-extra-com-vendas",
      titulo: "Renda extra com vendas",
      descricao: "O que avaliar antes de escolher o que vender.",
      ctaId: "p5_to_p1",
    },
    {
      to: "/como-comecar-a-vender-semijoias",
      titulo: "Como começar a vender semijoias do zero",
      descricao: "Os primeiros passos, do produto ao relacionamento.",
      ctaId: "p5_to_p2",
    },
  ],
  ctaFinal: {
    titulo: "Quer revender semijoias com estrutura e acompanhamento?",
    texto:
      "Conheça como funciona ser Consultora Lardan: maleta em consignação, CRM, vitrine digital, formação e 2 anos de garantia nas peças.",
    rotulo: "Quero ser Consultora Lardan",
    ctaId: "p5_to_seja",
  },
};
