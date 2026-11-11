/**
 * Cálculo do teste de candidatura — roda SÓ no servidor (a candidata não altera o resultado).
 * Nenhum resultado aprova ou reprova sozinho: o sistema sugere; analista e gestor decidem.
 */
import { DISC, FRASES, FATORES, ORGANIZACAO, type Fator, type Respostas, type RespostaDisc } from "./perguntas";
import type { ParametrosTeste } from "./padrao";

export type Faixa = "alta" | "media" | "baixa";
export type Cor = "verde" | "amarelo" | "vermelho";
export type Risco = "baixo" | "medio" | "alto";

export interface ResultadoTeste {
  versao_teste: string;
  r: { r1: number; r2: number; r3: number; r4: number; r5: number; r6: number };
  rp_base: number; rp: number; rp_faixa: Faixa;
  disc: Record<Fator, number>; disc_pct: Record<Fator, number>; disc_perfil: string; disc_principal: Fator;
  disciplina: number; iniciativa: number;
  av: number; av_faixa: Faixa;
  o: { o1: number; o2: number; o3: number; o4: number; o5: number }; o_soma: number;
  ioa: number; risco_acerto: Risco; sinais_criticos: string[];
  semaforo_base: Cor; semaforo_final: Cor; rebaixado: boolean;
  ipl: number; publico_sugerido: number;
  alertas: string[];
  disc_segundos: number | null;
}

const lim = (v: number) => Math.max(0, Math.min(100, v));
const pts = (p: ParametrosTeste, campo: string, cod: string | undefined) => (cod ? (p.pontos[campo]?.[cod] ?? 0) : 0);
const faixa = (v: number, alta: number, media: number): Faixa => (v >= alta ? "alta" : v >= media ? "media" : "baixa");

export function discBruto(resps: (RespostaDisc | null | undefined)[]): Record<Fator, number> {
  const x: Record<Fator, number> = { D: 0, I: 0, S: 0, C: 0 };
  for (const r of resps) { if (!r) continue; x[r.mais] += 1; x[r.menos] -= 1; }
  return x;
}

/** Principal = maior; empate na ordem I, S, D, C. Secundário só se > 0. */
export function perfilDisc(x: Record<Fator, number>): { perfil: string; principal: Fator } {
  const ordem: Fator[] = ["I", "S", "D", "C"];
  const ord = [...ordem].sort((a, b) => x[b] - x[a] || ordem.indexOf(a) - ordem.indexOf(b));
  const p = ord[0]!; const s = ord[1]!;
  return { principal: p, perfil: x[s] > 0 ? `${p}+${s}` : p };
}

export function notaFrases(frases: Record<string, number> | undefined, grupo: "disciplina" | "iniciativa"): number {
  const itens = FRASES.filter((f) => f.grupo === grupo && typeof frases?.[f.id] === "number");
  if (itens.length === 0) return 50;
  const soma = itens.reduce((s, f) => s + (f.invertida ? 6 - frases![f.id]! : frases![f.id]!), 0);
  return Math.round(((soma - itens.length) / (4 * itens.length)) * 100);
}

export function semaforo(rp: Faixa, av: Faixa): Cor {
  if (rp === "alta") return "verde";
  if (rp === "media") return av === "alta" ? "verde" : "amarelo";
  return av === "alta" ? "amarelo" : "vermelho";
}

export function calcular(
  r: Respostas, disc: (RespostaDisc | null | undefined)[], p: ParametrosTeste,
  opts: { ajuste?: boolean; discInicio?: string | null; discFim?: string | null } = {},
): ResultadoTeste {
  const onde = Math.min(p.onde_max, (r.onde_pretende_vender?.length ?? 0) * p.onde_por_item);
  const rr = {
    r1: pts(p, "contatos_semana", r.contatos_semana), r2: pts(p, "publico_feminino", r.publico_feminino), r3: onde,
    r4: pts(p, "experiencia_venda", r.experiencia_venda), r5: pts(p, "contatos_whatsapp", r.contatos_whatsapp), r6: pts(p, "horas_semana", r.horas_semana),
  };
  const rp_base = rr.r1 + rr.r2 + rr.r3 + rr.r4 + rr.r5 + rr.r6;
  const rp = Math.min(100, rp_base + (opts.ajuste ? p.ajuste_rp : 0));
  const rp_faixa = faixa(rp, p.faixas.rp_alta, p.faixas.rp_media);

  const x = discBruto(disc);
  const disc_pct = Object.fromEntries(FATORES.map((f) => [f, (x[f] + 20) * 2.5])) as Record<Fator, number>;
  const { perfil, principal } = perfilDisc(x);
  const disciplina = notaFrases(r.frases, "disciplina");
  const iniciativa = notaFrases(r.frases, "iniciativa");
  const av = Math.round(p.pesos.av_disc * lim(50 + 2.5 * x.I) + p.pesos.av_iniciativa * iniciativa);
  const av_faixa = faixa(av, p.faixas.av_alta, p.faixas.av_media);

  const o = { o1: pts(p, "o1", r.o1), o2: pts(p, "o2", r.o2), o3: pts(p, "o3", r.o3), o4: pts(p, "o4", r.o4), o5: pts(p, "o5", r.o5) };
  const o_soma = o.o1 + o.o2 + o.o3 + o.o4 + o.o5;
  const ioa = Math.round(p.pesos.ioa_o * o_soma + p.pesos.ioa_disciplina * disciplina + p.pesos.ioa_cs * lim(50 + 2.5 * (x.C + x.S)));
  const sinais_criticos = (["o2", "o3", "o4", "o5"] as const).filter((k) => r[k] && r[k] === p.criticos[k]);
  const n = sinais_criticos.length;
  const risco_acerto: Risco = ioa < p.faixas.ioa_alto || n >= 2 ? "alto" : ioa < p.faixas.ioa_medio || n === 1 ? "medio" : "baixo";

  const semaforo_base = semaforo(rp_faixa, av_faixa);
  const semaforo_final: Cor = risco_acerto === "alto" && semaforo_base === "verde" ? "amarelo" : semaforo_base;
  const ipl = Math.round((p.pesos.ipl_rp * rp + p.pesos.ipl_av * av) * 10) / 10;

  const seg = opts.discInicio && opts.discFim ? Math.round((Date.parse(opts.discFim) - Date.parse(opts.discInicio)) / 1000) : null;
  const a = p.alertas;
  const alertas: string[] = [];
  if (seg !== null && seg < a.disc_rapido_s) alertas.push("disc_rapido");
  if (FATORES.every((f) => Math.abs(x[f]) <= a.disc_plano)) alertas.push("disc_plano");
  if (x.I + x.D >= a.vitrine_id && x.C <= a.vitrine_c) alertas.push("disc_vitrine");
  if (x.D + x.I + x.S + x.C !== 0 || disc.filter(Boolean).length < DISC.length) alertas.push("disc_incompleto");
  for (const k of sinais_criticos) alertas.push(`critico_${k}`);
  const g14 = disc[13];
  if (g14 && (g14.mais === "D" || g14.mais === "I")) alertas.push("dinheiro_disc");
  if (x.I >= a.fiado_i && x.C <= a.fiado_c) alertas.push("fiado_perfil");
  if (r.restricao_declarada === "sim") alertas.push("cpf_declarado_sim");
  if (r.restricao_declarada === "nao") alertas.push("cpf_declarado_nao");
  if (r.o1 === "anota" && x.C <= a.anota_c) alertas.push("anota_incoerente");
  if (o_soma === 100 && x.C < 0 && x.S < 0) alertas.push("organizacao_vitrine");
  const vals = FRASES.map((f) => r.frases?.[f.id]);
  if (vals.every((v) => typeof v === "number" && v >= 4)) alertas.push("concorda_tudo");

  return {
    versao_teste: p.versao, r: rr, rp_base, rp, rp_faixa,
    disc: x, disc_pct, disc_perfil: perfil, disc_principal: principal, disciplina, iniciativa, av, av_faixa,
    o, o_soma, ioa, risco_acerto, sinais_criticos, semaforo_base, semaforo_final, rebaixado: semaforo_final !== semaforo_base,
    ipl, publico_sugerido: rp_faixa === "alta" ? 2 : rp_faixa === "media" ? 1 : 0, alertas, disc_segundos: seg,
  };
}

export const ALERTA_TEXTO: Record<string, string> = {
  disc_rapido: "Respostas rápidas demais no perfil",
  disc_plano: "Perfil inconclusivo: avaliar na conversa",
  disc_vitrine: "Perfil \"de vitrine\": confirmar com perguntas de fatos",
  disc_incompleto: "Há grupo sem resposta",
  critico_o2: "Sinal crítico: deixa pagar quando a cliente puder",
  critico_o3: "Sinal crítico: atrasou contas algumas vezes ou deixou acumular",
  critico_o4: "Sinal crítico: espera vender mais para acertar tudo junto",
  critico_o5: "Sinal crítico: usa o dinheiro das vendas e repõe depois",
  dinheiro_disc: "Atenção: escolha sobre dinheiro",
  fiado_perfil: "I alto com C baixo: tendência a fiado e pouca anotação",
  cpf_declarado_sim: "Declarou restrição: sinceridade; Serasa decide o tamanho",
  cpf_declarado_nao: "Se o Serasa mostrar restrição, sinal forte (omitiu)",
  anota_incoerente: "Diz que anota tudo, mas C muito baixo: pedir para mostrar",
  organizacao_vitrine: "Nota máxima em organização com C e S negativos",
  concorda_tudo: "Concorda com tudo: pesar menos o autodeclarado",
};

export const O_QUE_FAZER: Record<Cor, string> = {
  verde: "Entrevista normal, maleta padrão se nota ≥ 12.",
  amarelo: "Entrevista com foco no público real, tendência a maleta menor.",
  vermelho: "Entrevista curta de 10 min; sem público, recusar e guardar para recontato em 6 meses.",
};

/** O que falta responder (todas obrigatórias na versão final). */
export function faltando(r: Respostas, disc: (RespostaDisc | null | undefined)[]): string[] {
  const f: string[] = [];
  if (!r.experiencia_venda) f.push("experiencia_venda");
  if (!r.horas_semana) f.push("horas_semana");
  if (!r.local_trabalho) f.push("local_trabalho");
  for (const k of ["contatos_semana", "publico_feminino", "contatos_whatsapp"] as const) if (!r[k]) f.push(k);
  if (!r.onde_pretende_vender?.length) f.push("onde_pretende_vender");
  for (const o of ORGANIZACAO) if (!r[o.id]) f.push(o.id);
  if (!r.restricao_declarada) f.push("restricao_declarada");
  for (const fr of FRASES) if (typeof r.frases?.[fr.id] !== "number") f.push(fr.id);
  DISC.forEach((_, i) => { const d = disc[i]; if (!d || d.mais === d.menos) f.push(`disc_${i + 1}`); });
  return f;
}

