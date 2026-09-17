/**
 * LARDAN — Hub editorial.
 *
 * Estrutura de dados dos guias públicos. O conteúdo vive em módulos de dados
 * puros (sem JSX) para que o mesmo texto alimente HTML renderizado no servidor,
 * índice de âncoras e JSON-LD (FAQ nunca existe só no schema).
 */

export type Bloco =
  | { tipo: "paragrafo"; texto: string }
  | { tipo: "lista"; itens: string[]; ordenada?: boolean }
  | { tipo: "subtitulo"; texto: string }
  | { tipo: "citacao"; texto: string; autor?: string }
  | { tipo: "destaque"; titulo?: string; texto: string }
  | { tipo: "tabela"; legenda?: string; colunas: string[]; linhas: string[][] };

export interface Secao {
  /** Âncora estável usada no índice (href="#id"). */
  id: string;
  /** H2 visível. */
  titulo: string;
  /** Rótulo curto exibido no índice; quando ausente usa o título. */
  rotulo?: string;
  blocos: Bloco[];
}

export interface FaqItem {
  pergunta: string;
  resposta: string;
}

export interface LinkRelacionado {
  to: string;
  titulo: string;
  descricao: string;
  /** Identificador do CTA para atribuição interna (ex.: p1_to_p2). */
  ctaId: string;
}

export interface Guia {
  slug: string;
  /** Caminho público, sempre iniciando com "/". */
  path: string;
  eyebrow: string;
  title: string;
  description: string;
  h1: string;
  subheadline: string;
  /** Primeiro parágrafo de resposta direta (aparece antes do índice). */
  aberturaTitulo?: string;
  abertura: string[];
  secoes: Secao[];
  faqTitulo: string;
  faq: FaqItem[];
  /** ISO date. Não alterar sem revisão editorial real. */
  publicadoEm: string;
  atualizadoEm: string;
  /** Chaves de fontes usadas (ver src/lib/editorial/fontes.ts). */
  fontes: string[];
  relacionados: LinkRelacionado[];
  /** CTA comercial forte, próximo ao final. */
  ctaFinal: { titulo: string; texto: string; rotulo: string; ctaId: string };
  /** Chave da imagem de herói (ver src/lib/editorial/imagens.ts). */
  imagem: string;
}

/** Palavras por minuto usadas na estimativa honesta de leitura. */
const PPM = 210;

function textoDoBloco(b: Bloco): string {
  switch (b.tipo) {
    case "paragrafo":
    case "subtitulo":
      return b.texto;
    case "citacao":
      return `${b.texto} ${b.autor ?? ""}`;
    case "destaque":
      return `${b.titulo ?? ""} ${b.texto}`;
    case "lista":
      return b.itens.join(" ");
    case "tabela":
      return [b.legenda ?? "", ...b.colunas, ...b.linhas.flat()].join(" ");
  }
}

export function tempoDeLeitura(guia: Guia): number {
  const partes = [
    guia.h1,
    guia.subheadline,
    ...guia.abertura,
    ...guia.secoes.flatMap((s) => [s.titulo, ...s.blocos.map(textoDoBloco)]),
    ...guia.faq.flatMap((f) => [f.pergunta, f.resposta]),
  ];
  const palavras = partes.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.round(palavras / PPM));
}

export function dataExtenso(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}
