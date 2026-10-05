/**
 * LARDAN — Hub editorial.
 *
 * PÁGINA 6: Como cuidar de semijoias (garantia e cuidados).
 *
 * Primeira página do hub voltada a quem COMPRA. Também é o destino do link
 * "Garantia e cuidados" do rodapé. A garantia de 2 anos é fato oficial; as
 * condições detalhadas são da marca e não são descritas aqui.
 */
import type { Guia } from "./tipos";

export const GUIA_CUIDADOS: Guia = {
  slug: "como-cuidar-de-semijoias",
  path: "/como-cuidar-de-semijoias",
  eyebrow: "GUIA LARDAN",
  title: "Como Cuidar de Semijoias e Evitar que Escureçam | Lardan",
  description:
    "Por que a semijoia escurece, como limpar, como guardar e quando tirar a peça. Entenda também a garantia legal e a garantia de 2 anos das semijoias Lardan.",
  h1: "Como cuidar de semijoias para que durem muito mais",
  subheadline:
    "O banho de uma semijoia é uma camada fina de metal precioso. Alguns hábitos simples fazem a diferença entre uma peça que perde o brilho em meses e uma que acompanha você por anos.",
  aberturaTitulo: "Resposta curta",
  abertura: [
    "Para a semijoia durar, a regra é evitar atrito e química: coloque a peça depois de perfume, creme e maquiagem, tire antes de banho, piscina, mar, academia e para dormir, limpe com pano macio e seco depois de usar e guarde cada peça separada, em local seco.",
    "Esses cuidados valem para qualquer marca, porque o desgaste do banho é físico e químico. A garantia complementa o cuidado: ela cobre defeitos de fabricação, não o desgaste causado por uso inadequado.",
  ],
  secoes: [
    {
      id: "por-que-escurece",
      titulo: "Por que a semijoia escurece ou perde o brilho?",
      rotulo: "Por que escurece",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "A semijoia é feita de uma base metálica coberta por um banho de metal precioso, como ouro, prata ou ródio. Quando essa camada sofre atrito ou reage com substâncias químicas, ela vai ficando mais fina e o metal de base começa a aparecer ou a oxidar. É isso que a gente enxerga como peça escurecida, manchada ou sem brilho.",
        },
        { tipo: "paragrafo", texto: "Os principais responsáveis são:" },
        {
          tipo: "lista",
          itens: [
            "perfume, desodorante, hidratante, protetor solar e maquiagem aplicados com a peça no corpo;",
            "suor e oleosidade da pele, principalmente em dias quentes e durante exercício;",
            "cloro de piscina e produtos de limpeza da casa;",
            "água do mar e areia, que juntam sal e atrito;",
            "atrito com outras peças guardadas soltas na mesma caixa;",
            "umidade do banheiro, quando as peças ficam guardadas lá.",
          ],
        },
      ],
    },
    {
      id: "quando-tirar",
      titulo: "Quando tirar a semijoia",
      rotulo: "Quando tirar",
      blocos: [
        {
          tipo: "destaque",
          titulo: "Regra prática",
          texto: "A semijoia é a última coisa que você coloca e a primeira que você tira.",
        },
        {
          tipo: "tabela",
          legenda: "Situações do dia a dia e o cuidado recomendado",
          colunas: ["Situação", "O que fazer", "Por quê"],
          linhas: [
            ["Banho", "Tirar", "Sabonete, xampu e água quente aceleram o desgaste do banho"],
            ["Piscina e mar", "Tirar", "Cloro e sal atacam o banho; areia causa atrito"],
            ["Academia e esportes", "Tirar", "Suor e impacto desgastam e podem amassar a peça"],
            ["Dormir", "Tirar", "Atrito com lençol e travesseiro, e risco de entortar"],
            ["Limpeza da casa", "Tirar", "Produtos de limpeza são agressivos ao metal"],
            ["Passar perfume e creme", "Colocar depois", "Espere secar antes de colocar a peça"],
            ["Uso no dia a dia", "Pode usar", "Com limpeza simples ao tirar"],
          ],
        },
      ],
    },
    {
      id: "como-limpar",
      titulo: "Como limpar semijoias",
      rotulo: "Como limpar",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "Na maior parte das vezes, basta passar um pano macio, seco e limpo, como uma flanela de óculos, depois de usar. Isso tira suor e oleosidade antes que reajam com o banho.",
        },
        {
          tipo: "paragrafo",
          texto:
            "Se a peça estiver com resíduo de creme ou poeira, lave rapidamente com água morna e um pouco de sabão neutro, sem esfregar, e seque muito bem com o pano macio antes de guardar. Umidade guardada junto com a peça é uma das causas mais comuns de mancha.",
        },
        { tipo: "subtitulo", texto: "O que não usar" },
        {
          tipo: "lista",
          itens: [
            "pasta de dente, bicarbonato ou qualquer produto abrasivo, que riscam e removem o banho;",
            "álcool, água sanitária, removedor de esmalte e produtos de limpeza;",
            "escova de cerdas duras e palha de aço;",
            "receitas caseiras encontradas na internet que prometem devolver o brilho: elas costumam tirar o que resta do banho.",
          ],
        },
      ],
    },
    {
      id: "como-guardar",
      titulo: "Como guardar semijoias",
      rotulo: "Como guardar",
      blocos: [
        {
          tipo: "lista",
          itens: [
            "cada peça separada, em saquinho de tecido macio ou caixa com divisórias, para evitar atrito e arranhões;",
            "correntes fechadas, para não embaraçar e não forçar elos e fechos;",
            "local seco e arejado, longe do banheiro e de janelas com sol direto;",
            "longe de perfumes e cosméticos guardados no mesmo armário.",
          ],
        },
        {
          tipo: "paragrafo",
          texto:
            "Para quem viaja, uma necessaire própria para as peças evita que elas fiquem soltas na bolsa junto com chaves, moedas e cosméticos.",
        },
      ],
    },
    {
      id: "alergia",
      titulo: "Semijoia dá alergia?",
      rotulo: "Alergia",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "Algumas pessoas têm alergia de contato a metais, sendo o níquel uma das causas mais conhecidas. Vermelhidão, coceira ou bolhas no local de contato com a peça são sinais para tirar a semijoia e procurar orientação médica, de preferência de um dermatologista.",
        },
        {
          tipo: "paragrafo",
          texto:
            "Quem já sabe que tem sensibilidade deve perguntar à marca qual é o metal de base e a composição do banho antes de comprar.",
        },
      ],
    },
    {
      id: "garantia",
      titulo: "Garantia: o que é da lei e o que é da marca",
      rotulo: "Garantia",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "Pelo Código de Defesa do Consumidor, o consumidor tem 90 dias para reclamar de vícios em produtos duráveis (art. 26). Essa é a garantia legal, que vale para qualquer compra.",
        },
        {
          tipo: "paragrafo",
          texto:
            "Além dela, a marca pode oferecer uma garantia contratual, que complementa a legal e precisa ser informada por escrito (art. 50). As semijoias Lardan têm 2 anos de garantia, conforme as condições oficiais informadas pela marca no momento da compra, algo raro no mercado de semijoias.",
        },
        { tipo: "subtitulo", texto: "Se a peça apresentar algum problema" },
        {
          tipo: "lista",
          ordenada: true,
          itens: [
            "Guarde o comprovante da compra.",
            "Fale com a consultora que vendeu a peça ou com a Lardan pela página de contato.",
            "Descreva o que aconteceu e, se possível, envie fotos da peça.",
          ],
        },
      ],
    },
    {
      id: "para-consultoras",
      titulo: "Para consultoras: cuidado também é pós-venda",
      rotulo: "Para consultoras",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "Explicar os cuidados na entrega da peça evita frustração da cliente e reduz pedidos de troca por desgaste. Uma mensagem curta com as orientações deste guia, enviada alguns dias depois da compra, é um pós-venda simples que mostra cuidado e abre espaço para a próxima venda.",
        },
      ],
    },
  ],
  faqTitulo: "Perguntas frequentes sobre cuidados com semijoias",
  faq: [
    {
      pergunta: "Posso tomar banho com semijoia?",
      resposta:
        "Não é recomendado. Sabonete, xampu e água quente aceleram o desgaste do banho de metal precioso. Tire a peça antes do banho e coloque de volta depois que a pele estiver seca.",
    },
    {
      pergunta: "Como tirar o escurecido da semijoia?",
      resposta:
        "Quando o escurecido é só sujeira ou resíduo, uma limpeza com pano macio ou com água morna e sabão neutro, secando bem em seguida, costuma resolver. Quando o banho já se desgastou, nenhum produto caseiro devolve a camada de metal; nesse caso, procure a marca para avaliar a garantia.",
    },
    {
      pergunta: "Semijoia pode molhar?",
      resposta:
        "Respingos ocasionais não estragam a peça, desde que ela seja seca logo em seguida. O que desgasta é o contato frequente com água, principalmente com cloro, sal, sabonete e produtos de limpeza.",
    },
    {
      pergunta: "Qual é a garantia das semijoias Lardan?",
      resposta:
        "As peças Lardan têm 2 anos de garantia, conforme as condições oficiais informadas pela marca no momento da compra. Ela complementa a garantia legal do Código de Defesa do Consumidor.",
    },
  ],
  publicadoEm: "2026-10-05",
  atualizadoEm: "2026-10-05",
  fontes: ["cdc", "lardan_institucional"],
  imagem: "produto",
  relacionados: [
    {
      to: "/semijoia-folheado-ou-bijuteria",
      titulo: "Semijoia, folheado ou bijuteria?",
      descricao: "As diferenças de material, banho, durabilidade e garantia.",
      ctaId: "p6_to_p7",
    },
    {
      to: "/semijoias",
      titulo: "Conheça as semijoias Lardan",
      descricao: "Anéis, colares, pulseiras e brincos com 2 anos de garantia.",
      ctaId: "p6_to_catalogo",
    },
    {
      to: "/a-lardan",
      titulo: "A história da Lardan",
      descricao: "Fabricação própria, curadoria de importação e os fundadores.",
      ctaId: "p6_to_alardan",
    },
    {
      to: "/como-vender-semijoias-pelo-whatsapp",
      titulo: "Pós-venda pelo WhatsApp",
      descricao: "Para consultoras: como orientar a cliente depois da compra.",
      ctaId: "p6_to_p4",
    },
  ],
  ctaFinal: {
    titulo: "Semijoias com 2 anos de garantia",
    texto:
      "Conheça o catálogo Lardan: fabricação própria, curadoria de importação e garantia de 2 anos, conforme as condições oficiais da marca.",
    rotulo: "Ver as semijoias",
    ctaId: "p6_to_catalogo_final",
    to: "/semijoias",
  },
};
