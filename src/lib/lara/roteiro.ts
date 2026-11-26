/**
 * 0402 — O roteiro da Lara: entende a resposta (regras; a IA só entra quando a regra não entende) e decide o próximo passo.
 * Puro (sem banco e sem rede) para ser testado. Dúvida livre ou qualquer coisa fora do roteiro vai para uma pessoa.
 */
import { BOTAO, TEXTO } from "./textos";

export type Intencao = "sim" | "nao" | "pensar" | null;
export type ComoConheceu = "indicacao" | "instagram" | "google" | "outro" | null;
export type Leitura = {
  intencao: Intencao; duvida: boolean; robo: boolean; sair: boolean; humano: boolean; revisao: boolean; link: boolean;
  comoConheceu: ComoConheceu; entendeu: boolean;
};
export type Estado = "nova" | "msg1" | "msg2" | "teste" | "lembrete" | "teste_feito" | "pensando" | "desistiu" | "expirada" | "aprovada" | "recusada" | "revisao_pedida";

/** minúsculas, sem acento, espaços simples */
export const normalizar = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}?!,.\s]/gu, " ").replace(/\s+/g, " ").trim();

const BOTOES: Record<string, Partial<Leitura>> = {
  [normalizar(BOTAO.sim)]: { intencao: "sim" },
  [normalizar(BOTAO.combinado)]: { intencao: "sim" },
  [normalizar(BOTAO.pensar)]: { intencao: "pensar" },
  [normalizar(BOTAO.nao)]: { intencao: "nao" },
  [normalizar(BOTAO.revisao)]: { revisao: true },
};

const tem = (t: string, r: RegExp) => r.test(t);

export function ler(textoBruto: string | null | undefined): Leitura {
  const t = normalizar(textoBruto ?? "");
  const vazio: Leitura = { intencao: null, duvida: false, robo: false, sair: false, humano: false, revisao: false, link: false, comoConheceu: null, entendeu: false };
  if (!t) return vazio;
  const botao = BOTOES[t];
  if (botao) return { ...vazio, ...botao, entendeu: true };

  const r: Leitura = { ...vazio };
  r.sair = tem(t, /\b(sair|parar|pare|stop|descadastr\w*|nao (quero|desejo) (mais )?receber|para de (me )?mandar|nao me mande|remover meu numero)\b/);
  r.robo = tem(t, /\b(robo|robozinho|bot|chatbot|inteligencia artificial|maquina|automatic[oa])\b|\b(e|eh|vc e|voce e|tu e) (uma? )?ia\b|\b(pessoa|humana?) de verdade\b|\b(voce|vc) e (de verdade|real|humana?)\b/);
  r.humano = tem(t, /\b(falar|conversar) com (uma |um |o |a )?(pessoa|atendente|humano|alguem|daniel|gerente|responsavel)\b|\batendente\b|\bquero (uma )?pessoa\b/);
  r.revisao = tem(t, /\b(revis\w*|rever|reconsider\w*|recorr\w*|reavali\w*)\b/);
  r.link = tem(t, /\b(link|teste|nao (consigo|consegui) abrir|nao abre|nao abriu)\b/);
  r.duvida = t.includes("?") || tem(t, /^(como|quanto|quantos|quantas|qual|quais|quando|onde|por que|porque|pq|o que|oque|precisa|preciso pagar|tem que|tenho que|posso|pode|e se|da pra|e o|e a)\b/);

  if (tem(t, /\b(nao tenho interesse|nao quero|nao vou|desist\w*|nao posso|nao da (pra mim)?|sem interesse|nao me interessa|nao,? obrigad\w*)\b/) || /^(nao|n|nop|nem)\b[.!]*$/.test(t)) r.intencao = "nao";
  else if (tem(t, /\b(pensar|vou ver|vou pensar|depois (eu )?(te )?(falo|respondo|vejo|chamo)|agora nao|mais tarde|talvez|nao sei( ainda)?|ainda nao sei|deixa eu ver)\b/)) r.intencao = "pensar";
  else if (tem(t, /^(sim|s|ss|si+m+|claro|com certeza|certeza|combinado|combinadissimo|ok|okay|okk+|beleza|blz|pode ser|isso|certo|certissimo|perfeito|bora|vamos|positivo|uhum|aham|tenho sim|quero sim|sim sim)\b/) ||
           /^(quero|tenho|quero muito|tenho muito)[!. ]*$/.test(t) ||
           tem(t, /\b(tenho interesse|quero sim|tenho sim|quero revender|quero participar|quero comecar|combinado|com certeza|sim,? tenho)\b/)) r.intencao = "sim";

  if (tem(t, /\b(indica\w*|indicou|amig[ao]s?|prima|primo|irma|irmao|tia|vizinh[ao]|conhecid[ao]|consultora|revendedora|me falou|me falaram|colega|cunhad[ao]|mae|filha)\b/)) r.comoConheceu = "indicacao";
  else if (tem(t, /\b(insta|instagram|instagran|ig|reels|story|stories)\b/)) r.comoConheceu = "instagram";
  else if (tem(t, /\b(google|pesquis\w*|site)\b/)) r.comoConheceu = "google";
  else if (tem(t, /\b(facebook|face|tiktok|tik tok|anuncio|propaganda|youtube|whatsapp de|grupo)\b/)) r.comoConheceu = "outro";

  r.entendeu = Boolean(r.intencao || r.sair || r.robo || r.humano || r.revisao || r.comoConheceu || r.duvida);
  return r;
}

/** Junta a leitura da regra com a da IA: a regra manda; a IA só preenche o que a regra não entendeu. */
export function juntar(regra: Leitura, ia: Partial<Leitura> | null): Leitura {
  if (!ia || regra.entendeu) return regra;
  return {
    ...regra,
    intencao: regra.intencao ?? ia.intencao ?? null,
    duvida: regra.duvida || Boolean(ia.duvida),
    robo: regra.robo || Boolean(ia.robo),
    sair: regra.sair || Boolean(ia.sair),
    humano: regra.humano || Boolean(ia.humano),
    revisao: regra.revisao || Boolean(ia.revisao),
    comoConheceu: regra.comoConheceu ?? ia.comoConheceu ?? null,
    entendeu: true,
  };
}

export type Envio = { tipo: "texto"; texto: string } | { tipo: "botoes"; texto: string; botoes: string[] } | { tipo: "link_teste"; modelo: "msg3" | "link_de_novo" };
export type Passo = {
  enviar: Envio[];
  estado?: Estado;
  proximaEmHoras?: number;
  limparProxima?: boolean;
  humano?: string;
  comoConheceu?: ComoConheceu;
  optOut?: boolean;
  revisao?: boolean;
};

export type Contexto = { estado: Estado; humano: boolean; optOut: boolean; nome: string; testeConcluido: boolean; soMidia: boolean };

const paraPessoa = (motivo: string): Passo => ({ enviar: [{ tipo: "texto", texto: TEXTO.humano() }], humano: motivo });

export function decidir(c: Contexto, l: Leitura): Passo {
  if (c.optOut) return { enviar: [] };
  if (l.sair) return { enviar: [{ tipo: "texto", texto: TEXTO.sair() }], optOut: true, limparProxima: true };
  if (c.humano) return { enviar: [], comoConheceu: l.comoConheceu }; // a equipe está conversando: a Lara só observa
  if (c.soMidia) return { enviar: [{ tipo: "texto", texto: TEXTO.midia() }] };
  if (l.robo) return { enviar: [{ tipo: "texto", texto: TEXTO.robo() }], comoConheceu: l.comoConheceu };
  if (l.humano) return paraPessoa("Pediu para falar com uma pessoa");

  const como = l.comoConheceu;
  const naoQuer: Passo = { enviar: [{ tipo: "texto", texto: TEXTO.nao(c.nome) }], estado: "desistiu", limparProxima: true, comoConheceu: como };
  const pensa: Passo = { enviar: [{ tipo: "texto", texto: TEXTO.pensar(c.nome) }], estado: "pensando", limparProxima: true, comoConheceu: como };
  const msg2: Passo = { enviar: [{ tipo: "botoes", texto: TEXTO.msg2(), botoes: [BOTAO.combinado, BOTAO.pensar] }], estado: "msg2", comoConheceu: como };
  const msg3: Passo = c.testeConcluido
    ? { enviar: [{ tipo: "texto", texto: TEXTO.testeJaFeito(c.nome) }], estado: "teste_feito", limparProxima: true, comoConheceu: como }
    : { enviar: [{ tipo: "link_teste", modelo: "msg3" }], estado: "teste", proximaEmHoras: 48, comoConheceu: como };

  switch (c.estado) {
    case "nova":
    case "msg1":
      if (l.intencao === "sim") return msg2; // a mensagem 2 já explica o consignado, inclusive para quem perguntou junto
      if (l.intencao === "nao") return naoQuer;
      if (l.intencao === "pensar") return pensa;
      if (como && !l.duvida) return { enviar: [{ tipo: "botoes", texto: TEXTO.confirmaInteresse(c.nome), botoes: [BOTAO.sim, BOTAO.pensar, BOTAO.nao] }], comoConheceu: como };
      return { ...paraPessoa(l.duvida ? "Dúvida antes de começar" : "Resposta que a Lara não entendeu"), comoConheceu: como };
    case "msg2":
      if (l.intencao === "sim" && !l.duvida) return msg3;
      if (l.intencao === "nao") return naoQuer;
      if (l.intencao === "pensar") return pensa;
      return { ...paraPessoa(l.duvida ? "Dúvida sobre o consignado" : "Resposta que a Lara não entendeu"), comoConheceu: como };
    case "pensando":
    case "desistiu":
      if (l.intencao === "sim" && !l.duvida) return msg2;
      if (l.intencao === "nao" || l.intencao === "pensar") return { enviar: [], comoConheceu: como };
      return paraPessoa("Voltou a falar depois de dizer que ia pensar");
    case "teste":
    case "lembrete":
      if (c.testeConcluido) return { enviar: [{ tipo: "texto", texto: TEXTO.analisando(c.nome) }], estado: "teste_feito", limparProxima: true };
      if (l.intencao === "nao") return naoQuer;
      if (l.intencao === "pensar") return { enviar: [{ tipo: "texto", texto: TEXTO.pensar(c.nome) }] };
      if (l.duvida) return paraPessoa("Dúvida sobre o teste");
      if (l.intencao === "sim" || l.link) return { enviar: [{ tipo: "link_teste", modelo: "link_de_novo" }] };
      return paraPessoa("Mensagem durante o teste");
    case "teste_feito":
      if (l.duvida || !l.entendeu) return paraPessoa("Mensagem depois do teste");
      return { enviar: [{ tipo: "texto", texto: TEXTO.analisando(c.nome) }] };
    case "recusada":
      if (l.revisao || l.intencao === "sim") return { enviar: [{ tipo: "texto", texto: TEXTO.revisaoRecebida(c.nome) }], revisao: true };
      return paraPessoa("Mensagem depois da recusa");
    case "aprovada":
      return paraPessoa("Aprovada mandou mensagem");
    default:
      return paraPessoa("Mensagem fora do roteiro");
  }
}
