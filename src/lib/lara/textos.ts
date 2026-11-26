/**
 * 0402 — Textos da Lara (roteiro do Daniel, 26/11/2026) e os modelos que a Meta aprova.
 * Mensagens iniciadas pela Lardan (fora da janela de 24 h) só saem como MODELO aprovado: mensagem 1, lembrete,
 * aprovação e resultado. As outras são respostas dentro da janela (texto livre ou botões).
 * Nada aqui promete aprovação, prazo ou renda.
 */
export const SITE = "https://www.lardan.com.br";
export const linkTeste = (token: string) => `${SITE}/candidatura/${token}`;
export const linkDocumentos = (token: string) => `${SITE}/documentos/${token}`;

export const BOTAO = {
  sim: "Sim, tenho interesse",
  pensar: "Preciso pensar",
  nao: "Não tenho interesse",
  combinado: "Combinado!",
  revisao: "Pedir revisão",
} as const;

const n = (nome: string) => nome || "tudo bem";

export const TEXTO = {
  msg2: () =>
    "Que bom! Só pra você saber como funciona: a maleta é consignada. Você fica com as peças, vende e acerta com a gente em 30 dias, devolvendo o que não vendeu. " +
    "Se não vender, você não tem custo nenhum, desde que devolva as peças: só acerta o que vendeu e ganha comissão em cima do vendido. Combinado?\n\n" +
    "Aqui na Lardan, você que é de Londrina e região tem a possibilidade de vir montar a sua maleta diretamente na empresa. " +
    "E para quem for de outra cidade, nossa equipe escolhe as melhores peças e envia pelo correio diretamente para a sua casa.",
  msg3: (nome: string, link: string) =>
    `Perfeito, ${n(nome)}! Agora o próximo passo é um teste rápido, de uns 10 minutos, em 3 partes: seu dia a dia e as pessoas que você alcança, ` +
    "como você se organiza com dinheiro e combinados, e um perfil de personalidade em que você marca a frase que mais e a que menos combina com você. " +
    `Não tem resposta certa ou errada, é só responder do jeito que você é. Ele fica salvo a cada tela: ${link}\n\n` +
    "Depois do teste, a gente faz uma consulta no seu CPF. Fica tranquila: é só para conhecer melhor o seu perfil, e ter o nome com restrição não impede sozinho a sua aprovação. " +
    "Qualquer dúvida é só me chamar!",
  testeJaFeito: (nome: string) =>
    `Perfeito, ${n(nome)}! Vi que você já fez o teste de perfil, obrigada! Agora a gente analisa o seu perfil e consulta o seu CPF ` +
    "(ter o nome com restrição não impede sozinho a aprovação). Assim que tiver o resultado, te aviso aqui.",
  confirmaInteresse: (nome: string) => `Obrigada por contar, ${n(nome)}! E só pra confirmar: você tem interesse em revender semijoias no consignado?`,
  nao: (nome: string) => `Tudo bem, ${n(nome)}! Obrigada pelo seu tempo. Se mudar de ideia, é só me chamar aqui que a gente continua de onde parou.`,
  pensar: (nome: string) => `Claro, ${n(nome)}, pensa com calma! Quando quiser seguir, é só me responder aqui que eu te mando o próximo passo.`,
  robo: () => "Sim! Sou a Lara, uma assistente de IA da Lardan Semijoias. Se quiser falar com uma pessoa da equipe, é só pedir.",
  humano: () => "Boa pergunta! Vou chamar uma pessoa da nossa equipe para te responder aqui mesmo, tá bom?",
  midia: () => "Ainda não consigo ouvir áudios nem ver arquivos por aqui. Pode me escrever, por favor?",
  sair: () => "Pronto, não vou mais te mandar mensagens. Se um dia quiser voltar, é só se cadastrar de novo em lardan.com.br. Obrigada!",
  linkDeNovo: (nome: string, link: string) => `Claro, ${n(nome)}! Aqui está o link do seu teste: ${link}\n\nEle fica salvo a cada tela.`,
  analisando: (nome: string) => `Recebemos o seu teste, ${n(nome)}, e estamos analisando. Assim que tiver o resultado, te aviso aqui.`,
  revisaoRecebida: (nome: string) => `Recebi seu pedido, ${n(nome)}. Uma pessoa da nossa equipe vai rever a sua candidatura e te responde aqui.`,
  desconhecido: () =>
    `Oi! Aqui é a Lara, assistente da Lardan Semijoias. Para se candidatar a revendedora, é só preencher em ${SITE}/seja-lardan. ` +
    "Se você já se candidatou com outro número, me diz o seu nome completo que eu chamo a equipe.",
};

export type Modelo = {
  nome: string;
  categoria: "UTILITY" | "MARKETING";
  corpo: string;
  exemplo: string[];
  botoes: ({ tipo: "QUICK_REPLY"; texto: string } | { tipo: "URL"; texto: string; url: string; exemplo: string })[];
};

/** Modelos para a Meta aprovar (pt_BR). Variáveis {{n}} nunca no começo nem no fim do texto (regra da Meta). */
export const MODELOS: Modelo[] = [
  {
    nome: "lara_candidatura_recebida",
    categoria: "UTILITY",
    corpo:
      "Oi, {{1}}! Aqui é a Lara, da Lardan Semijoias. Recebi sua candidatura e adorei saber do seu sonho: {{2}}. " +
      "Me conta: como você conheceu a Lardan? Foi por indicação de alguém ou pelo Instagram? " +
      "E só pra confirmar mesmo: você realmente tem interesse em revender semijoias no consignado, certo?",
    exemplo: ["Maria", "comprar minha casa"],
    botoes: [{ tipo: "QUICK_REPLY", texto: BOTAO.sim }, { tipo: "QUICK_REPLY", texto: BOTAO.pensar }, { tipo: "QUICK_REPLY", texto: BOTAO.nao }],
  },
  {
    nome: "lara_lembrete_teste",
    categoria: "UTILITY",
    corpo: "Oi, {{1}}! Vi que seu teste da Lardan ainda não ficou pronto. Quer ajuda com alguma parte? É só tocar no botão abaixo para continuar de onde parou.",
    exemplo: ["Maria"],
    botoes: [{ tipo: "URL", texto: "Continuar o teste", url: `${SITE}/candidatura/{{1}}`, exemplo: `${SITE}/candidatura/0123456789abcdef` }],
  },
  {
    nome: "lara_aprovada_documentos",
    categoria: "UTILITY",
    corpo:
      "Parabéns, {{1}}! Seu cadastro na Lardan foi aprovado. Para seguir com a sua maleta, precisamos de 4 fotos: documento com foto, " +
      "comprovante de residência, uma selfie com o documento e a frente da sua casa. Leva uns 5 minutos pelo botão abaixo.",
    exemplo: ["Maria"],
    botoes: [{ tipo: "URL", texto: "Enviar documentos", url: `${SITE}/documentos/{{1}}`, exemplo: `${SITE}/documentos/0123456789abcdef` }],
  },
  {
    nome: "lara_resultado_candidatura",
    categoria: "UTILITY",
    corpo:
      "Oi, {{1}}. Obrigada pelo seu interesse na Lardan Semijoias. Analisamos a sua candidatura e, neste momento, não vamos seguir com a maleta. " +
      "Se quiser que uma pessoa da nossa equipe reveja, é só tocar em Pedir revisão.",
    exemplo: ["Maria"],
    botoes: [{ tipo: "QUICK_REPLY", texto: BOTAO.revisao }],
  },
];
