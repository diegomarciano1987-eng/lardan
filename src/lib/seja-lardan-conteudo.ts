/**
 * Conteúdo textual da página /seja-lardan.
 *
 * Tom oficial: a estrutura da Consultora Lardan é descrita no presente, porque
 * está entregue. Nada aqui pode prometer renda.
 * Nada aqui pode prometer renda, garantia de ganho ou resultado — apenas
 * estrutura, tecnologia e acompanhamento da marca.
 */

export type EstadoRecurso = "disponivel" | "preparacao";

export interface Ferramenta {
  chave: string;
  eyebrow: string;
  titulo: string;
  texto: string;
  itens: string[];
  estado: EstadoRecurso;
}

export const FERRAMENTAS: Ferramenta[] = [
  {
    chave: "crm",
    eyebrow: "Seu CRM",
    titulo: "Sua cliente. Seu relacionamento. Seu negócio mais organizado.",
    texto:
      "Relacionamento não precisa depender da memória. O CRM da Consultora Lardan reúne suas clientes, preferências e histórico em um só lugar.",
    itens: [
      "Cadastro de clientes",
      "Aniversários",
      "Preferências e peças favoritas",
      "Histórico de compras",
      "Frequência e última compra",
    ],
    estado: "disponivel",
  },
  {
    chave: "vitrine",
    eyebrow: "Sua vitrine digital",
    titulo: "Você terá uma página própria para vender seus produtos.",
    texto:
      "Cada Consultora Lardan tem uma vitrine digital ligada ao ecossistema da marca para apresentar suas peças, compartilhar com as clientes e levar a maleta também para o digital.",
    itens: [
      "Endereço próprio dentro do ecossistema Lardan",
      "Catálogo oficial sempre atualizado",
      "Compartilhamento por WhatsApp e redes",
    ],
    estado: "disponivel",
  },
  {
    chave: "financeiro",
    eyebrow: "Seu dinheiro",
    titulo: "Venda melhor. Entenda melhor o seu dinheiro.",
    texto:
      "Organize vendas, recebimentos, valores a receber, valores devidos e acompanhe sua operação de forma simples. Não é conta digital, não é banco e não é aconselhamento financeiro.",
    itens: [
      "Entradas e vendas",
      "Recebimentos",
      "Valores a receber",
      "Valores devidos",
      "Visão de resultado",
    ],
    estado: "disponivel",
  },
  {
    chave: "metas",
    eyebrow: "Suas metas",
    titulo: "Você enxerga onde está e quanto falta para chegar ao próximo objetivo.",
    texto:
      "Acompanhe suas metas, evolução, campanhas e reconhecimento dentro da rede: evolução em vez de cobrança.",
    itens: ["Meta do período", "Evolução", "Níveis", "Ranking", "Campanhas", "Premiações"],
    estado: "disponivel",
  },
  {
    chave: "pagamentos",
    eyebrow: "Seus pagamentos",
    titulo: "Receber também precisa ser simples.",
    texto:
      "A consultora registra o recebimento na venda e também pode combinar o pagamento diretamente com a cliente.",
    itens: ["Link de pagamento", "Registro do recebimento na venda"],
    estado: "disponivel",
  },
];

export const ATRIBUTOS = [
  "Iniciativa",
  "Relacionamento",
  "Comprometimento",
  "Energia",
  "Vontade de aprender",
  "Vontade de crescer",
];

export const PROCESSO = [
  { passo: "Candidatura", texto: "Você preenche o formulário desta página." },
  { passo: "Análise", texto: "A equipe Lardan analisa o perfil e a região." },
  { passo: "Conversa", texto: "Um contato para entender seus objetivos e tirar dúvidas." },
  { passo: "Aprovação", texto: "A Lardan confirma a entrada na rede." },
  { passo: "Onboarding", texto: "Orientação sobre produto, atendimento e ferramentas." },
  { passo: "Primeira maleta", texto: "A seleção de peças para você começar a apresentar." },
  { passo: "Ativação", texto: "Você começa a vender com acompanhamento da marca." },
];

export const TREINAMENTOS = [
  "Vendas",
  "Produto",
  "Redes sociais",
  "Fotografia",
  "Atendimento",
  "Finanças",
  "Relacionamento",
  "Novas coleções",
];

/** FAQ visível na página — mesma fonte usada no JSON-LD FAQPage. */
export const FAQ: { pergunta: string; resposta: string }[] = [
  {
    pergunta: "O que é uma Consultora Lardan?",
    resposta:
      "Uma Consultora Lardan comercializa semijoias da marca e utiliza a estrutura comercial e tecnológica disponibilizada pela Lardan para organizar produtos, clientes, vendas e seu desenvolvimento dentro da rede. Não é emprego CLT nem contrato de trabalho: é uma parceria comercial.",
  },
  {
    pergunta: "Como faço para ser uma Consultora Lardan?",
    resposta:
      "Preencha o formulário de candidatura nesta página com seus dados de contato, cidade e informações sobre seu objetivo. A candidatura é registrada com um número de protocolo e analisada pela equipe Lardan.",
  },
  {
    pergunta: "Preciso ter experiência com vendas?",
    resposta:
      "Não é obrigatório. A experiência ajuda, mas a Lardan procura pessoas dispostas a construir relacionamento, atender bem e aprender. O conteúdo de formação da marca existe justamente para apoiar quem está começando.",
  },
  {
    pergunta: "Como funciona a candidatura?",
    resposta:
      "Toda candidatura passa por análise humana da equipe Lardan. Não há aprovação automática, promessa de prazo, de aprovação ou de renda. Após o envio, você recebe um protocolo e a equipe entra em contato pelos dados informados.",
  },
  {
    pergunta: "Como funciona a maleta Lardan?",
    resposta:
      "A maleta é a seleção inicial de peças que a consultora passa a apresentar às suas clientes depois da aprovação e do onboarding. As condições comerciais de cada maleta são apresentadas pela equipe Lardan durante a conversa de entrada.",
  },
  {
    pergunta: "As semijoias Lardan têm garantia?",
    resposta:
      "Sim. As peças Lardan têm 2 anos de garantia, conforme as condições oficiais informadas pela marca no momento da compra.",
  },
  {
    pergunta: "A Consultora Lardan terá ferramentas para organizar suas clientes?",
    resposta:
      "Sim. A Consultora Lardan tem um CRM com clientes, preferências, histórico, aniversários e frequência de compra, além do acompanhamento de vendas e recebimentos.",
  },
  {
    pergunta: "A consultora terá uma vitrine digital?",
    resposta:
      "Sim. Cada consultora tem uma vitrine digital individual, ligada ao catálogo oficial da marca, para compartilhar suas peças com as clientes pelo celular.",
  },
  {
    pergunta: "Existem treinamentos para consultoras?",
    resposta:
      "Sim. A Lardan Academy reúne formação em vendas, produto, redes sociais, fotografia, atendimento, finanças, relacionamento e lançamentos de coleção.",
  },
  {
    pergunta: "Posso vender Lardan pelo WhatsApp?",
    resposta:
      "Sim. A maior parte das vendas por relacionamento acontece no WhatsApp e no Instagram. As ferramentas do ecossistema Lardan são pensadas para apoiar exatamente esse tipo de venda pelo celular.",
  },
  {
    pergunta: "Como acompanhar minhas vendas e recebimentos?",
    resposta:
      "A consultora acompanha entradas, vendas, valores a receber, valores devidos e uma visão simples de resultado da própria operação.",
  },
  {
    pergunta: "Existe meta para Consultora Lardan?",
    resposta:
      "O acompanhamento de metas é parte do modelo: a consultora enxerga onde está e quanto falta para o próximo objetivo, com campanhas e reconhecimento ao longo do caminho.",
  },
  {
    pergunta: "Posso me cadastrar para vender semijoias Lardan na minha cidade?",
    resposta:
      "Sim, a candidatura é aberta a todo o Brasil e pede cidade e estado justamente para que a equipe avalie a região. A disponibilidade por cidade é confirmada pela equipe durante a análise.",
  },
];
