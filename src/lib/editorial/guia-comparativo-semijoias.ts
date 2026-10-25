/** Reuses the published article without changing its original URL or content. */
import { GUIA_SEMIJOIA_BIJUTERIA } from "./guia-semijoia-folheado-bijuteria";
import type { Guia } from "./tipos";

export const GUIA_COMPARATIVO_SEMIJOIAS: Guia = {
  ...GUIA_SEMIJOIA_BIJUTERIA,
  slug: "guia-semijoia-folheado-ou-bijuteria",
  path: "/guia/semijoia-folheado-ou-bijuteria",
  title: "Semijoia, folheado ou bijuteria: diferenças | Lardan",
  description: "Compare semijoia, folheado e bijuteria: material, banho, camada, durabilidade, preço e cuidados. Saiba o que avaliar antes de escolher suas peças.",
  publicadoEm: "2026-10-25",
  atualizadoEm: "2026-10-25",
  secoes: GUIA_SEMIJOIA_BIJUTERIA.secoes.map((secao) => secao.id !== "comparativo" ? secao : {
    ...secao,
    blocos: [{
      tipo: "tabela",
      legenda: "Comparação geral; os termos e as características variam por fabricante. O nome não garante a espessura do banho.",
      colunas: ["Critério", "Semijoia", "Folheado", "Bijuteria"],
      linhas: [
        ["Material e banho", "Base metálica com banho de ouro, prata ou ródio", "Termo usado por fabricantes para peças banhadas; pode ser sinônimo de semijoia", "Metais comuns, resina e outros; sem banho de metal precioso ou com camada muito fina"],
        ["Camada", "A espessura e o tipo do banho devem ser informados pelo fabricante", "O nome sozinho não define a espessura; pode indicar uma camada mais fina", "Geralmente sem banho de metal precioso ou com uma camada muito fina"],
        ["Durabilidade", "Depende da base, do banho, do acabamento e dos cuidados", "Depende das características reais da peça, não apenas do nome folheado", "Para uso frequente, tende a desgastar e escurecer mais rápido"],
        ["Preço", "Geralmente intermediário; avalie qualidade e garantia", "Compare base, banho e garantia antes de avaliar o preço", "Geralmente menor custo"],
        ["Cuidados", "Limpeza suave, guardar separada e evitar perfume, cloro e atrito", "Em peças banhadas, limpeza suave, guardar separada e evitar química e atrito", "Evitar química e atrito; os cuidados dependem do material"],
      ],
    }],
  }),
  relacionados: [
    ...GUIA_SEMIJOIA_BIJUTERIA.relacionados,
    {
      to: "/seja-lardan",
      titulo: "Seja Consultora Lardan",
      descricao: "Conheça a estrutura da marca e envie sua candidatura para análise da equipe.",
      ctaId: "guia_comparativo_to_seja_lardan",
    },
  ],
};