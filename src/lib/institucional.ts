/**
 * CONTEÚDO INSTITUCIONAL OFICIAL DA LARDAN.
 *
 * Texto enviado pela marca. Não reescrever, não "melhorar", não resumir e não
 * acrescentar fatos. A única alteração autorizada foi a substituição dos
 * travessões usados como pontuação por pontuação gramatical equivalente
 * (vírgula, dois-pontos, ponto ou parênteses) e a separação em parágrafos.
 *
 * Qualquer atualização deste arquivo exige texto oficial da marca.
 */

/* ------------------------------- Fundadores ------------------------------- */

export const DANIEL = {
  nome: "Daniel de Freitas Maciel",
  cargo: "Fundador e CEO da LARDAN",
  cargoCurto: "Fundador e CEO",
  paragrafos: [
    "Engenheiro civil de formação, Daniel construiu sua trajetória no universo da venda consignada muito antes da LARDAN existir. Foram 15 anos atuando com redes de consultoras (os primeiros no segmento de lingerie e moda fitness) até que a vida trouxe um chamado diferente.",
    "Com a chegada da primeira filha se aproximando e uma rotina de viagens constantes que ameaçava roubar o tempo mais importante, o tempo em família, Daniel e sua esposa tomaram uma decisão: construir algo próprio. Algo que desse a eles liberdade para estar presentes e, ao mesmo tempo, construir um legado.",
    "Assim nasceu a LARDAN.",
    "Hoje, à frente de uma rede de mais de 1.000 consultoras que já geraram mais de R$ 2,8 milhões em comissões, Daniel enxerga na LARDAN algo maior do que semijoias: um instrumento de formalização e renda para quem move o país de verdade. Em um cenário onde cada vez mais pessoas são empurradas para a informalidade, seu propósito é claro: fortalecer quem cuida da própria família com as próprias mãos, dando oportunidade real de crescimento a mulheres e homens que, assim como ele, lutam por quem amam.",
  ],
  citacao:
    "Meu objetivo é fortalecer esse mercado e dar oportunidade para quem realmente move o nosso país.",
  alt: "Daniel de Freitas Maciel, fundador e CEO da Lardan",
} as const;

export const LARISSA = {
  nome: "Larissa Persinato Dias Maciel",
  cargo: "Cofundadora e Diretora de Marketing, Comunicação e Operações",
  cargoCurto: "Cofundadora e Diretora de Marketing, Comunicação e Operações",
  paragrafos: [
    "A história da LARDAN começa, na verdade, antes da própria empresa, começa na faculdade, onde Larissa e Daniel se conheceram. Formada em Psicologia, Larissa trouxe para dentro da LARDAN algo que nenhum manual de negócios ensina: a capacidade de olhar para cada consultora, cada processo e cada peça com sensibilidade e cuidado genuínos.",
    "Hoje ela responde pela área de marketing, comunicação e operação da empresa, mas seu papel vai muito além do cargo. Larissa é a excelência aplicada em cada detalhe, em cada peça, em cada processo que carrega o nome LARDAN.",
    "Mãe presente e protetora, ela divide com naturalidade os papéis de mãe e empresária, sempre olhando mais para o outro do que para si mesma. É essa mesma entrega que ela leva para dentro da empresa: cuida da LARDAN como cuida da própria família.",
  ],
  citacao: "Ela é a excelência em cada peça, em cada processo executado.",
  alt: "Larissa Persinato Dias Maciel, cofundadora e diretora da Lardan",
} as const;

export const ALT_CASAL =
  "Daniel de Freitas Maciel e Larissa Persinato Dias Maciel, fundadores da Lardan";

/* --------------------------------- Empresa -------------------------------- */

export const EMPRESA = {
  nome: "LARDAN",
  fundacao: "Fundada em 2021, em Ibiporã/PR",
  anoFundacao: "2021",
  paragrafos: [
    "A LARDAN é uma marca de semijoias exclusivas e de altíssima qualidade que transforma vidas, não apenas de quem usa, mas de quem vende. Através do modelo de maletas em consignação, oferecemos a consultoras parceiras a estrutura completa para construir seus próprios negócios com independência, levando elegância, brilho e autoestima diretamente até a cliente final.",
    "Cada peça é desenvolvida com fabricação própria e curadoria de importação, com um banho de qualidade extrema. Por isso oferecemos 2 anos de garantia, algo raro no mercado de semijoias.",
    "Mas o que realmente nos diferencia não são só as peças: é a estrutura por trás delas. Tecnologia de ponta para gestão de estoque e comissões, aliada a um atendimento humano e único para cada consultora, porque acreditamos que negócio de verdade se constrói com proximidade, não só com sistema.",
    "Hoje presente em Paraná e São Paulo, a LARDAN já se prepara para expandir para todo o Brasil.",
    'E se você reparar bem, vai notar algo: não nos chamamos apenas de "semijoias". Somos LARDAN. Porque nosso propósito vai além do produto: queremos ser lembrados pelo que representamos, não só pelo que vendemos.',
  ],
} as const;

/** Valores oficiais. Sem explicação inventada: só o nome de cada valor. */
export const VALORES = [
  "Palavra Dada é Palavra Cumprida (nosso valor mais importante)",
  "Comprometimento com o Resultado do Cliente",
  "Excelência com Simplicidade",
  "Fé que Move, Justiça que Guia",
  "Proximidade e Verdade nas Relações",
  "Disciplina e Alta Performance",
  "Evolução Contínua",
  "Integridade",
  "Lealdade",
  "Proatividade que Antecede, Resolve e Surpreende",
  "Resiliência com Atitude e Consistência",
  "Todo Mundo Vende",
  "Inovação Inteligente",
] as const;

/* -------------------------------- Endereço -------------------------------- */

export const ENDERECO = {
  logradouro: "Av. dos Estudantes, 1277",
  bairro: "Eloy Brusch",
  cidade: "Ibiporã",
  uf: "PR",
  cep: "86200-055",
  pais: "Brasil",
} as const;

export const ENDERECO_LINHAS = [
  ENDERECO.logradouro,
  ENDERECO.bairro,
  `${ENDERECO.cidade} - ${ENDERECO.uf}`,
  `CEP ${ENDERECO.cep}`,
  ENDERECO.pais,
] as const;

export const ENDERECO_UMA_LINHA = `${ENDERECO.logradouro}, ${ENDERECO.bairro}, ${ENDERECO.cidade} - ${ENDERECO.uf}, ${ENDERECO.cep}, ${ENDERECO.pais}`;

/** Link leve de mapa (sem iframe, sem custo de performance). */
export const MAPA_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  ENDERECO_UMA_LINHA,
)}`;

/* ----------------------- Resumo emocional /seja-lardan --------------------- */

export const HISTORIA_RESUMO = {
  titulo: "A Lardan também começou com uma decisão.",
  paragrafos: [
    "A história da Lardan nasceu de uma decisão de Daniel e Larissa.",
    "Depois de 15 anos atuando no universo da venda consignada, Daniel vivia uma rotina de viagens constantes. Com a chegada da primeira filha se aproximando, ele e Larissa decidiram construir algo próprio, que permitisse estar mais presentes e, ao mesmo tempo, construir um legado.",
    "Assim nasceu a Lardan, em 2021, em Ibiporã, no Paraná.",
    "Talvez por isso exista algo que levamos tão a sério: por trás de cada consultora existe uma pessoa, uma família, uma motivação e uma história que é só dela.",
  ],
  cta: "Conheça nossa história",
} as const;
