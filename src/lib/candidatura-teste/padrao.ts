/** Parâmetros do teste (versão do documento de 30/09/2026). Configurações grava novas versões por cima. */
export interface ParametrosTeste {
  versao: string;
  pontos: Record<string, Record<string, number>>;
  onde_por_item: number;
  onde_max: number;
  criticos: Record<"o2" | "o3" | "o4" | "o5", string>;
  ajuste_rp: number;
  faixas: { rp_alta: number; rp_media: number; av_alta: number; av_media: number; ioa_alto: number; ioa_medio: number };
  pesos: { av_disc: number; av_iniciativa: number; ioa_o: number; ioa_disciplina: number; ioa_cs: number; ipl_rp: number; ipl_av: number };
  alertas: { disc_rapido_s: number; disc_plano: number; vitrine_id: number; vitrine_c: number; fiado_i: number; fiado_c: number; anota_c: number };
  validade_dias: number;
  /** Textos por fator principal (D/I/S/C). Vazios até o Daniel colar os do protótipo. */
  textos: { devolutiva: Record<string, string>; entrevista: Record<string, string>; acompanhamento: Record<string, string> };
}

export const PADRAO: ParametrosTeste = {
  versao: "2026-09-30",
  pontos: {
    experiencia_venda: { vende_hoje: 20, ja_vendeu: 12, nunca: 0 },
    horas_semana: { ate3: 0, "3a6": 5, "7a15": 10, mais15: 15 },
    contatos_semana: { ate20: 0, "21a50": 8, "51a100": 15, mais100: 20 },
    publico_feminino: { quase_todas: 15, metade: 8, poucas: 2 },
    contatos_whatsapp: { ate50: 0, "51a100": 5, "101a200": 10, mais200: 15 },
    o1: { anota: 20, nocao: 10, nao: 0 },
    o2: { so_pagamento: 20, amiga: 8, quando_puder: 0 },
    o3: { em_dia: 20, poucos_dias: 8, varias: 0 },
    o4: { devolvo: 20, prazo: 8, espero: 0 },
    o5: { separado: 20, conta_anoto: 10, uso: 0 },
  },
  onde_por_item: 5,
  onde_max: 15,
  criticos: { o2: "quando_puder", o3: "varias", o4: "espero", o5: "uso" },
  ajuste_rp: 15,
  faixas: { rp_alta: 60, rp_media: 35, av_alta: 65, av_media: 45, ioa_alto: 45, ioa_medio: 70 },
  pesos: { av_disc: 0.7, av_iniciativa: 0.3, ioa_o: 0.5, ioa_disciplina: 0.3, ioa_cs: 0.2, ipl_rp: 0.6, ipl_av: 0.4 },
  alertas: { disc_rapido_s: 120, disc_plano: 4, vitrine_id: 20, vitrine_c: -12, fiado_i: 8, fiado_c: -8, anota_c: -8 },
  validade_dias: 15,
  textos: { devolutiva: { D: "", I: "", S: "", C: "" }, entrevista: { D: "", I: "", S: "", C: "" }, acompanhamento: { D: "", I: "", S: "", C: "" } },
};

/** Junta a versão gravada por cima do padrão (campos que faltarem ficam no padrão). */
export function mesclarParametros(p: Partial<ParametrosTeste> | null | undefined): ParametrosTeste {
  if (!p) return PADRAO;
  const pontos = { ...PADRAO.pontos };
  for (const [k, v] of Object.entries(p.pontos ?? {})) pontos[k] = { ...(PADRAO.pontos[k] ?? {}), ...v };
  return {
    ...PADRAO, ...p, pontos,
    criticos: { ...PADRAO.criticos, ...(p.criticos ?? {}) },
    faixas: { ...PADRAO.faixas, ...(p.faixas ?? {}) },
    pesos: { ...PADRAO.pesos, ...(p.pesos ?? {}) },
    alertas: { ...PADRAO.alertas, ...(p.alertas ?? {}) },
    textos: {
      devolutiva: { ...PADRAO.textos.devolutiva, ...(p.textos?.devolutiva ?? {}) },
      entrevista: { ...PADRAO.textos.entrevista, ...(p.textos?.entrevista ?? {}) },
      acompanhamento: { ...PADRAO.textos.acompanhamento, ...(p.textos?.acompanhamento ?? {}) },
    },
  };
}
