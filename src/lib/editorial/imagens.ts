/**
 * Imagens dos guias. Somente ativos reais já existentes no projeto.
 * Nada de fotografia gerada de pessoa, cliente ou maleta inexistente.
 */
import vidaReal from "@/assets/lardan-consultora-vida-real.webp.asset.json";
import consultoraHero from "@/assets/lardan-consultora-hero.webp.asset.json";
import ferramentas from "@/assets/lardan-consultora-ferramentas.webp.asset.json";
import danielRetrato from "@/assets/lardan-daniel-1.webp.asset.json";

export interface ImagemEditorial {
  url: string;
  alt: string;
  width: number;
  height: number;
}

export const IMAGENS_EDITORIAIS: Record<string, ImagemEditorial> = {
  vida_real: {
    url: vidaReal.url,
    alt: "Consultora Lardan organizando o dia entre a rotina de casa e o atendimento às clientes",
    width: 1408,
    height: 1008,
  },
  consultora_semijoias: {
    url: consultoraHero.url,
    alt: "Consultora Lardan apresentando semijoias a uma cliente",
    width: 1280,
    height: 1600,
  },
  produto: {
    // Versão otimizada (WebP, ~46 KB) do mesmo enquadramento aprovado.
    url: "/img/lardan-brincos-fundo-novo.webp",
    alt: "Semijoias Lardan fotografadas em estúdio",
    width: 1600,
    height: 900,
  },
  ferramentas: {
    url: ferramentas.url,
    alt: "Consultora Lardan usando o celular para atender clientes e registrar vendas",
    width: 1408,
    height: 1008,
  },
};

export const RETRATO_AUTOR: ImagemEditorial = {
  url: danielRetrato.url,
  alt: "Daniel de Freitas Maciel, fundador e CEO da Lardan",
  width: 900,
  height: 1125,
};
