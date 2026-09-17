/**
 * LARDAN — Hub editorial.
 *
 * PÁGINA 3: Semijoias consignadas para revenda.
 */
import type { Guia } from "./tipos";

export const GUIA_CONSIGNADO: Guia = {
  slug: "semijoias-consignadas-para-revenda",
  path: "/semijoias-consignadas-para-revenda",
  eyebrow: "GUIA LARDAN",
  title: "Semijoias Consignadas para Revenda: Entenda Como Funciona | Lardan",
  description:
    "Entenda a revenda consignada de semijoias: maleta, estoque, acerto, peças não vendidas, garantia, responsabilidades e o que avaliar antes de começar.",
  h1: "Semijoias consignadas para revenda: entenda como funciona antes de começar",
  subheadline:
    "Consignação pode reduzir a necessidade de comprar estoque antecipadamente, mas exige regras claras. Saiba o que perguntar antes de aceitar uma maleta.",
  abertura: [
    "Uma das maiores dúvidas de quem pensa em revender semijoias é simples:",
    "“Preciso comprar uma grande quantidade de peças antes de saber se vou conseguir vender?”",
    "É justamente aqui que surge o modelo consignado.",
    "Na consignação, a consultora recebe produtos para comercializar conforme as regras acordadas com a empresa.",
    "O modelo pode reduzir a necessidade de comprar antecipadamente todo o estoque.",
    "Mas consignado não significa “produto sem responsabilidade”.",
    "Antes de começar, você precisa compreender: quem é responsável pelas peças, prazo, acerto, devolução, pagamento, troca, garantia, perdas, contrato, comissão, reposição e análise cadastral.",
    "Esta página existe para explicar as perguntas que precisam ser feitas antes do cadastro.",
  ],
  secoes: [
    {
      id: "o-que-sao-semijoias-consignadas",
      titulo: "O que são semijoias consignadas?",
      rotulo: "O que são",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "São peças disponibilizadas para venda dentro de uma relação comercial em que a consultora não necessariamente compra todo o conjunto antecipadamente.",
        },
        {
          tipo: "paragrafo",
          texto: "A empresa fornece os produtos conforme suas regras comerciais.",
        },
        {
          tipo: "paragrafo",
          texto:
            "A consultora apresenta as peças, registra vendas e posteriormente realiza o acerto conforme o contrato e o modelo utilizado.",
        },
        { tipo: "paragrafo", texto: "As condições variam entre empresas." },
        {
          tipo: "paragrafo",
          texto: "Por isso, nunca escolha uma oportunidade apenas porque viu a frase “sem investimento”. Leia as condições.",
        },
      ],
    },
    {
      id: "consignacao-ou-comprar-semijoias-no-atacado",
      titulo: "Consignação ou comprar semijoias no atacado?",
      rotulo: "Consignação x atacado",
      blocos: [
        {
          tipo: "tabela",
          legenda: "Comparativo entre consignação e compra de estoque no atacado",
          colunas: ["Critério", "Consignação", "Compra no atacado"],
          linhas: [
            ["Compra inicial do estoque", "Reduzida ou dispensada, conforme regra da empresa", "Necessária, com capital próprio"],
            ["Risco de peças paradas", "Compartilhado conforme contrato", "Assumido integralmente pela compradora"],
            ["Liberdade sobre estoque", "Definida pelas regras da empresa fornecedora", "Total, dentro da própria gestão"],
            ["Responsabilidade pelas peças", "Da consultora enquanto estiverem sob sua guarda", "Da compradora, desde a aquisição"],
            ["Capital necessário", "Menor exposição inicial de capital", "Maior, proporcional ao volume comprado"],
            ["Margem/comissão", "Definida em contrato com a empresa", "Definida pela própria revendedora, sobre o preço de venda"],
            ["Troca de peças", "Depende da política de cada empresa", "Depende de acordos com fornecedores"],
            ["Prazo", "Definido em contrato", "Não se aplica da mesma forma"],
            ["Acerto", "Ocorre conforme condições contratuais", "Não há acerto; a compra já é definitiva"],
            ["Suporte", "Pode incluir estrutura de apoio da empresa", "Depende de cada fornecedor"],
          ],
        },
        {
          tipo: "paragrafo",
          texto:
            "Comprar estoque pode fazer sentido para quem possui capital, conhece sua demanda e deseja assumir integralmente o risco e a gestão do estoque.",
        },
        {
          tipo: "paragrafo",
          texto:
            "Consignação pode fazer sentido para quem prefere começar com menor exposição a uma compra inicial de estoque, desde que compreenda as responsabilidades contratuais.",
        },
      ],
    },
    {
      id: "o-que-acontece-se-eu-nao-vender-todas-as-pecas",
      titulo: "O que acontece se eu não vender todas as peças?",
      rotulo: "Peças não vendidas",
      blocos: [
        { tipo: "paragrafo", texto: "Depende das regras da empresa." },
        { tipo: "paragrafo", texto: "Antes de aceitar uma maleta, pergunte:" },
        {
          tipo: "lista",
          itens: [
            "Posso devolver peças não vendidas?",
            "Existe período mínimo?",
            "Há regra de troca?",
            "Quem paga o transporte?",
            "Qual é o prazo para acerto?",
            "Existem metas?",
            "Qual é a responsabilidade em caso de dano ou perda?",
          ],
        },
        {
          tipo: "paragrafo",
          texto:
            "Essas condições são definidas em contrato e apresentadas durante o processo de candidatura à Lardan, disponível em /seja-lardan.",
        },
      ],
    },
    {
      id: "preciso-investir-para-vender-semijoias-consignadas",
      titulo: "Preciso investir para vender semijoias consignadas?",
      rotulo: "Investimento",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "Consignação reduz a necessidade de comprar antecipadamente todo o estoque, mas cada empresa define regras próprias.",
        },
        {
          tipo: "paragrafo",
          texto:
            "Pode haver custos, caução, transporte, responsabilidade por peças, contrato ou outras condições, a depender da empresa.",
        },
        {
          tipo: "paragrafo",
          texto:
            "Na Lardan, essas condições comerciais são apresentadas durante o processo de candidatura, em /seja-lardan.",
        },
      ],
    },
    {
      id: "existe-analise-para-receber-uma-maleta",
      titulo: "Existe análise para receber uma maleta?",
      rotulo: "Análise e aprovação",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "Empresas podem realizar análise antes de entregar produtos consignados porque existe patrimônio sob responsabilidade de terceiros.",
        },
        { tipo: "paragrafo", texto: "Na Lardan, a entrada começa por uma candidatura. Depois:" },
        {
          tipo: "lista",
          itens: ["Análise", "Conversa", "Aprovação", "Onboarding", "Primeira maleta", "Ativação"],
        },
        { tipo: "paragrafo", texto: "Não há garantia de aprovação." },
      ],
    },
    {
      id: "preciso-ter-cnpj",
      titulo: "Preciso ter CNPJ?",
      rotulo: "CNPJ e formalização",
      blocos: [
        {
          tipo: "paragrafo",
          texto:
            "A formalização depende da natureza e do estágio da atividade de cada consultora, e não existe uma resposta jurídica universal válida para todos os cenários.",
        },
        {
          tipo: "paragrafo",
          texto:
            "Orientações tributárias devem ser confirmadas em canais oficiais, como o Portal do Empreendedor, um contador ou a autoridade competente.",
        },
        {
          tipo: "paragrafo",
          texto: "Os requisitos atuais de cadastro para ser candidata à Lardan são apresentados em /seja-lardan.",
        },
      ],
    },
    {
      id: "como-funciona-o-acerto-de-uma-maleta-consignada",
      titulo: "Como funciona o acerto de uma maleta consignada?",
      rotulo: "Acerto",
      blocos: [
        { tipo: "paragrafo", texto: "A consultora registra as vendas." },
        {
          tipo: "paragrafo",
          texto: "A empresa identifica produtos vendidos e produtos que continuam sob responsabilidade da consultora.",
        },
        { tipo: "paragrafo", texto: "O acerto financeiro segue as condições contratuais." },
        {
          tipo: "paragrafo",
          texto: "Produtos não vendidos seguem a regra definida para devolução, permanência ou troca.",
        },
        {
          tipo: "paragrafo",
          texto: "Na Lardan, o CRM próprio ajuda a organizar a rastreabilidade dessa operação.",
        },
      ],
    },
    {
      id: "o-que-acontece-se-uma-peca-for-perdida",
      titulo: "O que acontece se uma peça for perdida?",
      rotulo: "Perda de peças",
      blocos: [
        { tipo: "paragrafo", texto: "Depende do contrato." },
        {
          tipo: "paragrafo",
          texto:
            "Toda candidata deve compreender a responsabilidade sobre os produtos recebidos antes de aceitar uma maleta.",
        },
        {
          tipo: "paragrafo",
          texto: "Esse risco não deve ser suavizado. Transparência gera mais confiança do que esconder uma regra difícil.",
        },
      ],
    },
    {
      id: "as-pecas-possuem-garantia",
      titulo: "As peças possuem garantia?",
      rotulo: "Garantia",
      blocos: [
        {
          tipo: "paragrafo",
          texto: "Na Lardan, sim. As semijoias Lardan possuem 2 anos de garantia, conforme as condições oficiais da marca.",
        },
        {
          tipo: "paragrafo",
          texto: "Saiba mais sobre a marca, a fabricação própria e a curadoria de importação em /a-lardan.",
        },
      ],
    },
    {
      id: "quanto-uma-revendedora-de-semijoias-pode-ganhar",
      titulo: "Quanto uma revendedora de semijoias pode ganhar?",
      rotulo: "Resultado possível",
      blocos: [
        { tipo: "paragrafo", texto: "Não existe um valor universal." },
        { tipo: "paragrafo", texto: "O resultado depende de:" },
        {
          tipo: "lista",
          itens: [
            "Quantidade vendida",
            "Modelo comercial",
            "Comissão/margem",
            "Clientes",
            "Recebimento",
            "Despesas",
            "Tempo",
            "Frequência",
          ],
        },
        { tipo: "paragrafo", texto: "Nunca confunda venda, faturamento, comissão, recebimento e resultado." },
      ],
    },
    {
      id: "consignacao-resolve-o-estoque-organizacao-ajuda-a-resolver-o-restante",
      titulo: "Consignação resolve o estoque. Organização ajuda a resolver o restante.",
      rotulo: "Estrutura por trás da maleta",
      blocos: [
        { tipo: "paragrafo", texto: "Receber uma maleta não ensina automaticamente a:" },
        {
          tipo: "lista",
          itens: [
            "Conseguir clientes",
            "Lembrar preferências",
            "Fazer pós-venda",
            "Controlar recebimentos",
            "Acompanhar vendas",
            "Organizar metas",
          ],
        },
        { tipo: "paragrafo", texto: "Por isso, o diferencial da Lardan não está apenas nas peças. Está também na estrutura." },
        {
          tipo: "destaque",
          titulo: "CRM próprio e acompanhamento de vendas",
          texto:
            "A Lardan disponibiliza um CRM próprio, com vitrine digital e acompanhamento de vendas, para ajudar a consultora a organizar clientes, pedidos e histórico da maleta.",
        },
      ],
    },
    {
      id: "12-perguntas-para-fazer-antes-de-aceitar-qualquer-maleta-consignada",
      titulo: "12 perguntas para fazer antes de aceitar qualquer maleta consignada",
      rotulo: "Checklist",
      blocos: [
        {
          tipo: "lista",
          ordenada: true,
          itens: [
            "Preciso comprar alguma peça?",
            "Existe caução?",
            "Existe taxa?",
            "Quem responde por perda?",
            "Quem responde por dano?",
            "Qual é o prazo do ciclo?",
            "Como funciona o acerto?",
            "Posso devolver o que não vender?",
            "Como funciona a troca?",
            "Qual é a garantia?",
            "Existe suporte e treinamento?",
            "Como vou controlar clientes, vendas e recebimentos?",
          ],
        },
        {
          tipo: "citacao",
          texto: "Uma empresa séria precisa conseguir responder essas perguntas com clareza.",
        },
      ],
    },
  ],
  faqTitulo: "Perguntas frequentes sobre semijoias consignadas",
  faq: [
    {
      pergunta: "O que é consignação de semijoias?",
      resposta:
        "É um modelo comercial em que a consultora recebe peças para vender conforme regras definidas com a empresa fornecedora, sem precisar comprar todo o conjunto antecipadamente. A empresa disponibiliza os produtos e a consultora apresenta as peças, registra vendas e realiza o acerto conforme o contrato. As condições variam entre empresas, por isso é importante ler com atenção o que está sendo oferecido antes de aceitar qualquer maleta, em vez de decidir apenas pela ideia de “sem investimento”.",
    },
    {
      pergunta: "Como funciona uma maleta consignada?",
      resposta:
        "A empresa entrega um conjunto de peças à consultora, que passa a ter a responsabilidade de guardá-las e apresentá-las às clientes. As vendas são registradas e, periodicamente, ocorre o acerto: identificação do que foi vendido, do que continua sob responsabilidade da consultora e do destino das peças não vendidas. Prazos, forma de devolução e responsabilidade por dano ou perda são definidos em contrato e apresentados no processo de candidatura de cada empresa.",
    },
    {
      pergunta: "Preciso comprar estoque?",
      resposta:
        "No modelo consignado, a ideia é reduzir a necessidade de comprar antecipadamente todo o estoque, já que a empresa disponibiliza as peças para venda conforme suas regras. Isso não significa, porém, que não existam outras condições comerciais, como caução, taxa ou responsabilidade pelas peças recebidas. Cada empresa define seus próprios termos. Na Lardan, as condições comerciais são apresentadas durante o processo de candidatura, em /seja-lardan.",
    },
    {
      pergunta: "Existe investimento inicial?",
      resposta:
        "Depende da empresa. A consignação pode reduzir a necessidade de comprar estoque antecipadamente, mas isso não é sinônimo de ausência total de custos: pode haver caução, transporte ou outras condições contratuais. Desconfie de ofertas que resumem tudo à frase “sem investimento”, sem detalhar as regras. Antes de aceitar, pergunte com clareza o que é exigido. Na Lardan, essas condições são apresentadas no processo de candidatura, em /seja-lardan.",
    },
    {
      pergunta: "O que acontece com peças não vendidas?",
      resposta:
        "O destino das peças não vendidas depende das regras contratuais de cada empresa: pode haver devolução, permanência para um novo ciclo ou troca. Antes de aceitar uma maleta, é importante perguntar se existe possibilidade de devolução, período mínimo, quem paga o transporte e qual é o prazo para o acerto. Não existe uma regra única válida para todas as empresas de consignação, por isso essas perguntas precisam ser feitas antes do cadastro.",
    },
    {
      pergunta: "Existe caução?",
      resposta:
        "A existência ou não de caução, assim como seu valor e condições, é definida em contrato por cada empresa. Não é possível generalizar essa resposta para o mercado de consignação como um todo. Antes de aceitar qualquer maleta, pergunte diretamente se há caução, qual é o valor e em que situações ela é usada. Na Lardan, essa condição comercial é apresentada e esclarecida durante o processo de candidatura, em /seja-lardan.",
    },
    {
      pergunta: "Existe contrato?",
      resposta:
        "Sim, e é justamente o contrato que deve esclarecer pontos como responsabilidade pelas peças, prazo, forma de acerto, devolução, troca e eventual caução ou taxa. Uma empresa séria consegue apresentar essas condições com clareza antes da entrega da primeira maleta. Se uma oferta de consignação não deixa claro se existe contrato e o que ele prevê, isso é um sinal de que mais perguntas precisam ser feitas antes de aceitar.",
    },
    {
      pergunta: "Quem responde por peça perdida?",
      resposta:
        "A responsabilidade por peças perdidas ou danificadas é definida em contrato e varia entre empresas. Como existe patrimônio de terceiros sob a guarda da consultora, esse é um dos pontos mais importantes a esclarecer antes de aceitar uma maleta consignada. Não convém suavizar esse risco: é preciso compreender, com clareza, o que acontece em caso de perda antes de assumir a responsabilidade pelas peças recebidas.",
    },
    {
      pergunta: "Como funciona o acerto?",
      resposta:
        "No acerto, a empresa verifica o que foi vendido e o que continua sob responsabilidade da consultora, e o valor devido é apurado conforme as condições contratuais. Produtos não vendidos seguem a regra combinada, que pode envolver devolução, permanência ou troca. Prazo e forma exatos do acerto são definidos em contrato. Na Lardan, o CRM próprio ajuda a organizar essa rastreabilidade ao longo do ciclo da maleta.",
    },
    {
      pergunta: "Existe meta?",
      resposta:
        "A existência de metas, quando houver, é definida por cada empresa em suas condições comerciais. Antes de aceitar uma maleta consignada, vale perguntar diretamente se existem metas, quais são os critérios e o que acontece caso não sejam atingidas. Essa é uma das perguntas do checklist que toda candidata deveria fazer antes de assumir um compromisso de consignação, independentemente da empresa.",
    },
    {
      pergunta: "Posso devolver peças?",
      resposta:
        "A possibilidade de devolução de peças não vendidas depende das regras de cada empresa e deve estar prevista em contrato. Antes de aceitar uma maleta, pergunte se existe possibilidade de devolução, se há período mínimo e quem arca com o custo do transporte. Essas condições fazem parte do checklist de perguntas que qualquer candidata deveria levar para a conversa antes de assumir a responsabilidade pelas peças.",
    },
    {
      pergunta: "Posso trocar peças?",
      resposta:
        "A política de troca de peças dentro de uma maleta consignada varia entre empresas e deve estar definida em contrato. Algumas empresas permitem trocar peças que não têm saída por outras com maior potencial de venda; outras têm regras mais restritas. Antes de aceitar a maleta, pergunte como funciona a troca na prática, com que frequência é possível solicitá-la e se há algum custo envolvido.",
    },
    {
      pergunta: "Quanto ganha uma revendedora?",
      resposta:
        "Não existe um valor universal, pois o resultado depende de fatores como quantidade vendida, modelo comercial, comissão ou margem, base de clientes, forma de recebimento, despesas envolvidas, tempo dedicado e frequência de vendas. É importante não confundir venda, faturamento, comissão, recebimento e resultado, que são conceitos diferentes. Qualquer promessa de valor fixo de ganho, sem considerar essas variáveis, deve ser vista com cautela.",
    },
    {
      pergunta: "Preciso ter CNPJ?",
      resposta:
        "Não existe uma resposta jurídica universal válida para todos os cenários: a necessidade de formalização depende da natureza e do estágio da atividade de cada pessoa. Orientações tributárias devem ser confirmadas em canais oficiais, como o Portal do Empreendedor, um contador ou a autoridade competente. Os requisitos atuais de cadastro para ser candidata à Lardan são os apresentados no processo de candidatura, em /seja-lardan.",
    },
    {
      pergunta: "Posso vender pelo WhatsApp?",
      resposta:
        "Sim, o WhatsApp é um canal comum para apresentar peças, tirar dúvidas, combinar entregas e fazer o pós-venda com as clientes. Isso exige organização: saber o que cada cliente já viu ou comprou, responder com agilidade e manter um histórico do relacionamento. Uma vitrine digital e um CRM próprio, como os oferecidos pela Lardan às suas consultoras, ajudam a organizar esse atendimento em vez de depender apenas da memória.",
    },
    {
      pergunta: "Posso vender pelo Instagram?",
      resposta:
        "Sim, o Instagram pode ser usado para mostrar peças, contar novidades e atrair o interesse de clientes, funcionando como uma vitrine complementar ao atendimento direto. O fechamento da venda, porém, costuma acontecer em conversas individuais, muitas vezes pelo WhatsApp. Combinar os dois canais, com organização do relacionamento e das vendas, tende a funcionar melhor do que depender de apenas um deles.",
    },
    {
      pergunta: "As semijoias possuem garantia?",
      resposta:
        "Sim. As semijoias Lardan possuem 2 anos de garantia, conforme as condições oficiais da marca, que também mantém fabricação própria e curadoria de importação para suas peças. Essa é uma informação relevante tanto para a consultora, que apresenta um produto com respaldo, quanto para a cliente final, que compra com mais segurança. Mais detalhes sobre a estrutura da marca estão disponíveis em /a-lardan.",
    },
    {
      pergunta: "Como saber se uma empresa de consignação é confiável?",
      resposta:
        "Uma empresa séria consegue responder com clareza perguntas objetivas: se há caução ou taxa, quem responde por perda ou dano, qual é o prazo do ciclo, como funciona o acerto, se há devolução e troca, qual é a garantia das peças e se existe suporte e treinamento. A ausência de respostas claras, ou respostas vagas quando o assunto é responsabilidade e dinheiro, é um sinal de alerta que merece atenção antes de aceitar qualquer maleta.",
    },
    {
      pergunta: "Como funciona a candidatura Lardan?",
      resposta:
        "A entrada na Lardan começa por uma candidatura em /seja-lardan. A partir daí, o processo segue com análise, conversa, aprovação, onboarding, entrega da primeira maleta e ativação da consultora. A aprovação não é garantida a todas as candidatas. As condições comerciais específicas, como responsabilidades sobre as peças e forma de acerto, são apresentadas ao longo desse processo, e não antes dele.",
    },
    {
      pergunta: "Como solicitar informações sobre uma maleta Lardan?",
      resposta:
        "As informações oficiais sobre como funciona uma maleta Lardan, incluindo as condições comerciais do modelo consignado, são apresentadas dentro do processo de candidatura, disponível em /seja-lardan. A Lardan, fundada em 2021 em Ibiporã, no Paraná, e hoje presente no Paraná e em São Paulo, reúne fabricação própria, curadoria de importação e estrutura de acompanhamento, como CRM próprio e vitrine digital, apresentados às candidatas aprovadas.",
    },
  ],
  publicadoEm: "2026-09-17",
  atualizadoEm: "2026-09-17",
  fontes: ["portal_empreendedor", "lardan_institucional", "lardan_seja"],
  imagem: "produto",
  relacionados: [
    {
      to: "/como-comecar-a-vender-semijoias",
      titulo: "Como começar a vender semijoias do zero",
      descricao: "Os primeiros passos, do produto ao relacionamento com as clientes.",
      ctaId: "p3_to_p2",
    },
    {
      to: "/como-vender-semijoias-pelo-whatsapp",
      titulo: "Como vender semijoias pelo WhatsApp",
      descricao: "Como apresentar peças, responder objeções e organizar o pós-venda.",
      ctaId: "p3_to_p4",
    },
    {
      to: "/a-lardan",
      titulo: "A história da Lardan",
      descricao: "A marca, os fundadores e a estrutura por trás das maletas.",
      ctaId: "p3_to_alardan",
    },
    {
      to: "/semijoias",
      titulo: "Conheça as semijoias Lardan",
      descricao: "As peças que compõem as maletas, com 2 anos de garantia.",
      ctaId: "p3_to_catalogo",
    },
  ],
  ctaFinal: {
    titulo: "Quer saber como funciona uma maleta Lardan?",
    texto:
      "As condições comerciais do modelo consignado, incluindo responsabilidades e forma de acerto, são apresentadas dentro do processo de candidatura.",
    rotulo: "Quero me candidatar",
    ctaId: "p3_to_seja",
  },
};
