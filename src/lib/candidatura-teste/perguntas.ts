/**
 * Teste de candidatura Lardan (documento do Daniel, 30/09/2026) — textos e códigos das respostas.
 * Os pontos NÃO ficam aqui: ficam nos parâmetros (padrao.ts / Configurações) e são calculados no servidor.
 * Este arquivo vai para o navegador da candidata.
 */
export type Opcao = { codigo: string; texto: string };
export type Fator = "D" | "I" | "S" | "C";
export const FATORES: Fator[] = ["D", "I", "S", "C"];

export const SITE = {
  experiencia_venda: {
    pergunta: "Você já vende algum produto hoje?",
    opcoes: [
      { codigo: "vende_hoje", texto: "Sim, vendo hoje" },
      { codigo: "ja_vendeu", texto: "Já vendi e parei" },
      { codigo: "nunca", texto: "Nunca vendi" },
    ],
  },
  horas_semana: {
    pergunta: "Quanto tempo por semana você tem para vender?",
    opcoes: [
      { codigo: "ate3", texto: "Menos de 3 horas" },
      { codigo: "3a6", texto: "De 3 a 6 horas" },
      { codigo: "7a15", texto: "De 7 a 15 horas" },
      { codigo: "mais15", texto: "Mais de 15 horas" },
    ],
  },
} as const;

export const ACEITE_TEXTO =
  "Autorizo a Lardan a falar comigo pelo WhatsApp e a usar minhas respostas para avaliar meu cadastro.";

export const PARTE1 = {
  contatos_semana: {
    pergunta: "Com quantas pessoas você tem contato por semana?",
    opcoes: [
      { codigo: "ate20", texto: "Até 20" },
      { codigo: "21a50", texto: "De 21 a 50" },
      { codigo: "51a100", texto: "De 51 a 100" },
      { codigo: "mais100", texto: "Mais de 100" },
    ],
  },
  publico_feminino: {
    pergunta: "A maioria dessas pessoas é mulher?",
    opcoes: [
      { codigo: "quase_todas", texto: "Quase todas" },
      { codigo: "metade", texto: "Metade" },
      { codigo: "poucas", texto: "Poucas" },
    ],
  },
  onde_pretende_vender: {
    pergunta: "Onde você pretende mostrar as peças?",
    opcoes: [
      { codigo: "trabalho", texto: "Trabalho" },
      { codigo: "igreja", texto: "Igreja" },
      { codigo: "academia", texto: "Academia" },
      { codigo: "escola", texto: "Escola dos filhos" },
      { codigo: "faculdade", texto: "Faculdade/curso" },
      { codigo: "salao", texto: "Salão/estética" },
      { codigo: "familia", texto: "Família e vizinhança" },
      { codigo: "grupos", texto: "Grupos de WhatsApp/Instagram" },
    ],
  },
  contatos_whatsapp: {
    pergunta: "Quantos contatos você tem no WhatsApp?",
    opcoes: [
      { codigo: "ate50", texto: "Até 50" },
      { codigo: "51a100", texto: "De 51 a 100" },
      { codigo: "101a200", texto: "De 101 a 200" },
      { codigo: "mais200", texto: "Mais de 200" },
    ],
  },
} as const;

export const PARTE2_ABERTURA =
  "Na venda consignada você fica com as peças e acerta depois. Responda com sinceridade: isso define o tamanho da sua primeira maleta e o apoio que você vai receber.";

export const ORGANIZACAO: { id: "o1" | "o2" | "o3" | "o4" | "o5"; pergunta: string; opcoes: Opcao[] }[] = [
  { id: "o1", pergunta: "Como você controla seus gastos hoje?", opcoes: [
    { codigo: "anota", texto: "Anoto tudo (caderno ou aplicativo)" },
    { codigo: "nocao", texto: "Tenho uma noção de cabeça" },
    { codigo: "nao", texto: "Não controlo muito" } ] },
  { id: "o2", pergunta: "Toda vendedora recebe pedido de \"pagar depois\". Quando uma cliente te pede isso, você…", opcoes: [
    { codigo: "so_pagamento", texto: "Só entrego com pagamento na hora ou data combinada e anotada" },
    { codigo: "amiga", texto: "Deixo pagar depois se for amiga ou parente" },
    { codigo: "quando_puder", texto: "Deixo pagar quando ela puder, confio nas pessoas" } ] },
  { id: "o3", pergunta: "Quase todo mundo já atrasou uma conta. Nos últimos 12 meses, com suas contas, você…", opcoes: [
    { codigo: "em_dia", texto: "Paguei tudo no vencimento" },
    { codigo: "poucos_dias", texto: "Atrasei uma ou outra, poucos dias" },
    { codigo: "varias", texto: "Atrasei algumas vezes, ou deixei acumular" } ] },
  { id: "o4", pergunta: "No dia do acerto, se você não vendeu tudo o que esperava, você…", opcoes: [
    { codigo: "devolvo", texto: "Devolvo as peças e pago o que vendi no dia combinado" },
    { codigo: "prazo", texto: "Peço mais alguns dias de prazo" },
    { codigo: "espero", texto: "Espero vender mais para acertar tudo junto" } ] },
  { id: "o5", pergunta: "Onde você guardaria o dinheiro das vendas até o acerto?", opcoes: [
    { codigo: "separado", texto: "Separado, não mexo até o acerto" },
    { codigo: "conta_anoto", texto: "Na minha conta, junto com o resto, mas anoto" },
    { codigo: "uso", texto: "Uso se precisar e reponho depois" } ] },
];

export const RESTRICAO = {
  pergunta: "Seu CPF tem alguma restrição hoje?",
  dica: "Ter restrição não reprova sozinho.",
  opcoes: [
    { codigo: "nao", texto: "Não" },
    { codigo: "sim", texto: "Sim" },
    { codigo: "naosei", texto: "Não sei" },
  ],
} as const;

export const ESCALA = ["Nada parecido comigo", "Pouco", "Mais ou menos", "Muito", "Totalmente parecido comigo"];

/** Ordem da tela: L1, L5, L2, L6, L3, L7, L4, L8. */
export const FRASES: { id: string; texto: string; grupo: "disciplina" | "iniciativa"; invertida: boolean }[] = [
  { id: "l1", texto: "Cumpro o que combino, mesmo quando ninguém está me cobrando.", grupo: "disciplina", invertida: false },
  { id: "l5", texto: "Puxo conversa com facilidade, até com quem não conheço.", grupo: "iniciativa", invertida: false },
  { id: "l2", texto: "Anoto datas e compromissos para não esquecer.", grupo: "disciplina", invertida: false },
  { id: "l6", texto: "Tenho vergonha de oferecer um produto para alguém.", grupo: "iniciativa", invertida: true },
  { id: "l3", texto: "Costumo deixar para resolver as coisas na última hora.", grupo: "disciplina", invertida: true },
  { id: "l7", texto: "Se alguém diz \"agora não\", ofereço de novo outro dia sem problema.", grupo: "iniciativa", invertida: false },
  { id: "l4", texto: "Confiro valores, troco e contas antes de fechar.", grupo: "disciplina", invertida: false },
  { id: "l8", texto: "Gosto de contar para as pessoas sobre coisas que comprei e gostei.", grupo: "iniciativa", invertida: false },
];

export const DISC_ABERTURA =
  "Em cada grupo, marque a frase que MAIS tem a ver com você e a que MENOS tem a ver. Responda como você é hoje, não como gostaria de ser.";

/** 20 grupos; frases na ordem D, I, S, C (a tela sorteia a ordem por candidata). */
export const DISC: { enunciado: string; frases: [string, string, string, string] }[] = [
  { enunciado: "Eu sou uma pessoa que…", frases: ["Decide rápido", "Faz amizade com facilidade", "Tem paciência com as pessoas", "Faz as coisas com capricho"] },
  { enunciado: "Eu sou uma pessoa que…", frases: ["Gosta de desafio e de metas", "Adora conversar e contar novidades", "Prefere uma rotina tranquila", "Confere tudo antes de entregar"] },
  { enunciado: "Eu sou uma pessoa que…", frases: ["Fala o que pensa, direto", "Anima o ambiente onde está", "É leal a quem confia", "Segue regras e combinados à risca"] },
  { enunciado: "Eu sou uma pessoa que…", frases: ["Não gosta de perder", "Gosta de ser notada", "Evita brigas e discussões", "Gosta de entender os detalhes"] },
  { enunciado: "Eu sou uma pessoa que…", frases: ["Toma a frente quando ninguém decide", "Convence os outros com facilidade", "Ajuda sem precisar que peçam", "Anota tudo para não esquecer"] },
  { enunciado: "Eu sou uma pessoa…", frases: ["Determinada, vai até o fim", "Otimista, vê o lado bom", "Calma, mesmo sob pressão", "Organizada com suas coisas"] },
  { enunciado: "Quando recebo uma novidade, eu…", frases: ["Já penso em como aproveitar", "Conto logo para as amigas", "Espero para ver se é boa mesmo", "Pesquiso antes de opinar"] },
  { enunciado: "Num grupo de trabalho, eu…", frases: ["Lidero e divido as tarefas", "Animo e uno o grupo", "Faço a minha parte sem reclamar", "Garanto que tudo saia certo"] },
  { enunciado: "Quando alguém me diz \"não\", eu…", frases: ["Insisto e busco outro jeito", "Brinco e tento de novo mais tarde", "Aceito, não quero incomodar", "Quero entender o motivo"] },
  { enunciado: "O que mais me motiva é…", frases: ["Bater metas e ganhar", "Ser reconhecida e elogiada", "Ter segurança e estabilidade", "Fazer um trabalho bem feito"] },
  { enunciado: "Numa festa, eu normalmente…", frases: ["Puxo os assuntos que me interessam", "Converso com todo mundo, até com quem não conheço", "Fico perto de quem já conheço", "Observo mais do que falo"] },
  { enunciado: "Para resolver um problema, eu…", frases: ["Resolvo na hora, do meu jeito", "Peço opinião para várias pessoas", "Sigo o jeito que já deu certo", "Analiso com calma todas as opções"] },
  { enunciado: "Meus amigos dizem que eu sou…", frases: ["Forte e decidida", "Divertida e comunicativa", "Tranquila e de confiança", "Certinha e caprichosa"] },
  { enunciado: "Com dinheiro, eu…", frases: ["Arrisco para ganhar mais", "Gosto de aproveitar o momento", "Guardo para garantir o futuro", "Controlo cada centavo"] },
  { enunciado: "Quando começo algo novo, eu…", frases: ["Quero resultado rápido", "Fico empolgada e conto para todos", "Vou devagar até me sentir segura", "Primeiro estudo como funciona"] },
  { enunciado: "Se uma cliente reclama, eu…", frases: ["Resolvo logo e sigo em frente", "Converso com carinho e deixo ela de bom humor", "Escuto com paciência até ela se acalmar", "Explico direitinho as regras e a garantia"] },
  { enunciado: "Uma meta de venda, para mim, é…", frases: ["Um desafio que quero superar", "Uma chance de mostrar que sou boa", "Tranquila se for passo a passo", "Um número que preciso planejar"] },
  { enunciado: "Eu fico mal quando…", frases: ["Perco o controle da situação", "Fico sozinha, sem conversar", "Algo muda de repente", "Cometo um erro"] },
  { enunciado: "No tempo livre, prefiro…", frases: ["Fazer algo produtivo ou competitivo", "Sair e encontrar gente", "Ficar com a família", "Ler, assistir ou aprender algo"] },
  { enunciado: "No trabalho, prefiro que…", frases: ["Me deem liberdade para fazer do meu jeito", "Tenha gente animada ao redor", "As coisas sejam estáveis e previsíveis", "Tudo seja bem explicado e organizado"] },
];

export const FINAL_TEXTO =
  "Recebemos suas respostas. O próximo passo é uma conversa por vídeo de uns 20 minutos: vamos combinar o melhor horário aqui pelo WhatsApp.";

/** Respostas da candidata, como ficam gravadas (códigos, nunca pontos). */
export interface Respostas {
  experiencia_venda?: string;
  horas_semana?: string;
  local_trabalho?: string;
  contatos_semana?: string;
  publico_feminino?: string;
  onde_pretende_vender?: string[];
  contatos_whatsapp?: string;
  o1?: string; o2?: string; o3?: string; o4?: string; o5?: string;
  restricao_declarada?: string;
  frases?: Record<string, number>;
}
/** Uma resposta do DISC por grupo: o FATOR marcado em Mais e em Menos. */
export type RespostaDisc = { mais: Fator; menos: Fator };
