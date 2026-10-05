/**
 * LARDAN — Hub editorial.
 *
 * PÁGINA 7: Semijoia, folheado ou bijuteria — diferenças.
 *
 * Página para quem COMPRA (e para a consultora explicar à cliente). Não há
 * norma oficial no Brasil que defina espessura mínima de banho para cada
 * termo; por isso o texto orienta a perguntar, sem inventar números.
 */
import type { Guia } from "./tipos";

export const GUIA_SEMIJOIA_BIJUTERIA: Guia = {
  slug: "semijoia-folheado-ou-bijuteria",
  path: "/semijoia-folheado-ou-bijuteria",
  eyebrow: "GUIA LARDAN",
  title: "Semijoia, Folheado ou Bijuteria: Qual a Diferença? | Lardan",
  description:
    "Entenda a diferença entre joia, semijoia, folheado e bijuteria: material, banho, durabilidade, garantia e como avaliar a qualidade antes de comprar.",
  h1: "Semijoia, folheado ou bijuteria: qual a diferença e como escolher",
  subheadline:
    "Na vitrine, as três podem parecer iguais. A diferença está no que existe por baixo do brilho: o material, a camada de metal precioso e a garantia que a marca oferece.",
  aberturaTitulo: "Resposta curta",
  abertura: [
    "Semijoia é uma peça de metal com banho de metal precioso, como ouro, prata ou ródio, aplicado em camada mais resistente e com acabamento cuidadoso. Bijuteria é a peça de menor custo, geralmente sem banho de metal precioso ou com uma camada bem fina. Folheado é um termo que parte do mercado usa como sinônimo de semijoia e parte usa para peças de camada mais fina.",
    "Como não existe uma norma oficial que defina cada termo pela espessura do banho, o nome na etiqueta diz pouco. O que mostra a qualidade é o material de base, a espessura e o tipo do banho, o acabamento e, principalmente, a garantia por escrito.",
  ],
  secoes: [
    {
      id: "joia",
      titulo: "Primeiro, o que é joia",
      rotulo: "Joia",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "Joia é a peça feita inteiramente de metal precioso, como ouro ou prata. No ouro 18 quilates, 75% da liga é ouro puro (por isso a marcação 750); na prata 925, 92,5% é prata. Por ser maciça, a joia não tem banho para desgastar, mas custa muito mais.",
        },
      ],
    },
    {
      id: "semijoia",
      titulo: "O que é semijoia",
      rotulo: "Semijoia",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "A semijoia tem uma base metálica, muitas vezes latão, coberta por banho de metal precioso aplicado por eletrodeposição (galvanoplastia). Uma camada de verniz protetor pode completar o acabamento.",
        },
        {
          tipo: "paragrafo",
          texto:
            "O que diferencia uma boa semijoia é o cuidado em cada etapa: a qualidade da base, a espessura do banho, o acabamento das soldas e dos fechos e o controle de qualidade. Por isso as marcas que confiam na própria fabricação costumam oferecer garantia maior.",
        },
      ],
    },
    {
      id: "folheado",
      titulo: "E o folheado?",
      rotulo: "Folheado",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "\"Folheado\" e \"folheado a ouro\" são termos usados de formas diferentes por cada fabricante. Para alguns, é o mesmo que semijoia; para outros, indica uma peça com camada mais fina. Na prática, quando a etiqueta diz folheado, a pergunta certa continua sendo a mesma: qual é a base, qual é o banho e qual é a garantia.",
        },
      ],
    },
    {
      id: "bijuteria",
      titulo: "O que é bijuteria",
      rotulo: "Bijuteria",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "Bijuteria é a peça de moda feita para durar menos e custar menos. Pode usar metais comuns, resinas, plásticos, tecidos e pedras sintéticas, geralmente sem banho de metal precioso ou com uma camada muito fina. Faz sentido para acompanhar uma tendência por pouco tempo; para uso frequente, desgasta e escurece mais rápido.",
        },
      ],
    },
    {
      id: "comparativo",
      titulo: "Comparativo lado a lado",
      rotulo: "Comparativo",
      blocos: [
        {
          tipo: "tabela",
          legenda: "Diferenças gerais entre joia, semijoia e bijuteria (variam por fabricante)",
          colunas: ["Critério", "Joia", "Semijoia", "Bijuteria"],
          linhas: [
            ["Material", "Metal precioso maciço", "Base metálica com banho de metal precioso", "Metais comuns, resina e outros"],
            ["Durabilidade", "Muito alta", "Alta, com os cuidados certos", "Baixa a média"],
            ["Preço relativo", "Alto", "Intermediário", "Baixo"],
            ["Garantia", "Do fabricante", "Varia; as melhores marcas dão garantia longa e por escrito", "Geralmente curta ou só a legal"],
            ["Manutenção", "Limpeza e polimento", "Limpeza suave, guardar separada, evitar química", "Pouca, a peça é de ciclo curto"],
          ],
        },
      ],
    },
    {
      id: "como-avaliar",
      titulo: "Como avaliar a qualidade antes de comprar",
      rotulo: "Como avaliar",
      blocos: [
        {
          tipo: "lista",
          ordenada: true,
          itens: [
            "Pergunte o material de base e o metal do banho (ouro, prata, ródio).",
            "Pergunte a espessura do banho. Ela costuma ser informada em milésimos de milímetro; quem não sabe responder geralmente não controla a própria produção.",
            "Peça a garantia por escrito, com prazo e condições.",
            "Observe o acabamento: soldas sem rebarba, fechos firmes, pedras bem cravadas e brilho uniforme, inclusive na parte de trás da peça.",
            "Pergunte quem fabrica. Fabricação própria e curadoria de importação permitem controlar o padrão de cada lote.",
            "Desconfie de preço muito abaixo do mercado para uma peça vendida como semijoia.",
          ],
        },
      ],
    },
    {
      id: "lardan",
      titulo: "Como a Lardan trabalha",
      rotulo: "A Lardan",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "As peças Lardan são desenvolvidas com fabricação própria e curadoria de importação, com um banho de qualidade extrema. Por isso a marca oferece 2 anos de garantia, conforme as condições oficiais informadas no momento da compra, algo raro no mercado de semijoias.",
        },
      ],
    },
    {
      id: "para-quem-revende",
      titulo: "Para quem revende: por que isso importa",
      rotulo: "Para quem revende",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "Quem vende por relacionamento coloca o próprio nome em cada peça. Uma semijoia que dura e tem garantia reduz trocas, evita desgaste com a cliente e favorece a recompra e a indicação. Saber explicar essa diferença com clareza também ajuda a justificar o preço diante de peças mais baratas.",
        },
      ],
    },
  ],
  faqTitulo: "Perguntas frequentes",
  faq: [
    {
      pergunta: "Semijoia é a mesma coisa que folheado?",
      resposta:
        "Depende de quem usa o termo. Muitas marcas tratam os dois como sinônimos; outras chamam de folheado as peças de camada mais fina. Como não há norma oficial que defina cada nome, pergunte a base, o banho e a garantia.",
    },
    {
      pergunta: "Semijoia escurece?",
      resposta:
        "O banho de qualquer semijoia sofre com atrito, perfume, suor, cloro e água do mar. Com cuidados simples, como tirar a peça para banho e academia e guardá-la separada, ela dura muito mais. A garantia cobre defeitos de fabricação.",
    },
    {
      pergunta: "Vale mais a pena comprar semijoia ou bijuteria?",
      resposta:
        "Para peças de uso frequente, a semijoia costuma compensar pela durabilidade e pela garantia. A bijuteria faz sentido para acompanhar uma tendência por pouco tempo, gastando menos.",
    },
    {
      pergunta: "Como saber se a semijoia é de qualidade?",
      resposta:
        "Veja o acabamento, pergunte o material de base, o tipo e a espessura do banho e exija garantia por escrito. Marcas com fabricação própria e garantia longa costumam ter mais controle sobre a qualidade.",
    },
  ],
  publicadoEm: "2026-10-05",
  atualizadoEm: "2026-10-05",
  fontes: ["cdc", "lardan_institucional"],
  imagem: "produto",
  relacionados: [
    {
      to: "/como-cuidar-de-semijoias",
      titulo: "Como cuidar de semijoias",
      descricao: "Limpeza, armazenamento e quando tirar a peça.",
      ctaId: "p7_to_p6",
    },
    {
      to: "/semijoias",
      titulo: "Conheça as semijoias Lardan",
      descricao: "Anéis, colares, pulseiras e brincos com 2 anos de garantia.",
      ctaId: "p7_to_catalogo",
    },
    {
      to: "/perguntas-sobre-revenda-de-semijoias",
      titulo: "Revenda de semijoias: perguntas e respostas",
      descricao: "Para quem pensa em revender: consignado, maleta e acerto.",
      ctaId: "p7_to_p5",
    },
    {
      to: "/a-lardan",
      titulo: "A história da Lardan",
      descricao: "Fabricação própria, curadoria de importação e os fundadores.",
      ctaId: "p7_to_alardan",
    },
  ],
  ctaFinal: {
    titulo: "Semijoias com fabricação própria e 2 anos de garantia",
    texto:
      "Conheça o catálogo Lardan: anéis, colares, pulseiras e brincos com garantia de 2 anos, conforme as condições oficiais da marca.",
    rotulo: "Ver as semijoias",
    ctaId: "p7_to_catalogo_final",
    to: "/semijoias",
  },
};
