/**
 * Personalidade sutil de cada categoria pública.
 * Mesma família visual — apenas ritmo, proporção e frase editorial mudam.
 */
export interface PersonalidadeCategoria {
  /** Frase editorial curta exibida acima do nome da categoria. */
  frase: string;
  /** Proporção da imagem dos cards padrão. */
  proporcao: string;
  /** Proporção da imagem da peça de abertura. */
  proporcaoDestaque: string;
  /** Curvatura da moldura de vidro. */
  moldura: string;
  /** Legenda discreta usada nos blocos editoriais. */
  nota: string;
}

const PADRAO: PersonalidadeCategoria = {
  frase: "Peças escolhidas uma a uma.",
  proporcao: "4 / 5",
  proporcaoDestaque: "16 / 10",
  moldura: "rounded-[1.75rem]",
  nota: "Curadoria Lardan",
};

const MAPA: Record<string, PersonalidadeCategoria> = {
  aneis: {
    frase: "Formas que guardam histórias.",
    proporcao: "1 / 1",
    proporcaoDestaque: "3 / 2",
    moldura: "rounded-[2.5rem]",
    nota: "Volume, aro e acabamento",
  },
  colares: {
    frase: "A linha que desenha o gesto.",
    proporcao: "3 / 4",
    proporcaoDestaque: "4 / 3",
    moldura: "rounded-[1.5rem]",
    nota: "Caimento e desenho da peça",
  },
  pulseiras: {
    frase: "O movimento que acompanha o pulso.",
    proporcao: "5 / 4",
    proporcaoDestaque: "2 / 1",
    moldura: "rounded-full",
    nota: "Continuidade e delicadeza",
  },
  brincos: {
    frase: "Luz, simetria e presença.",
    proporcao: "1 / 1",
    proporcaoDestaque: "16 / 10",
    moldura: "rounded-[2rem]",
    nota: "Pares e brilho controlado",
  },
};

export function personalidade(slug: string): PersonalidadeCategoria {
  return MAPA[slug] ?? PADRAO;
}
