import { describe, expect, test } from "bun:test";
import { calcular, perfilDisc, semaforo } from "@/lib/candidatura-teste/calculo";
import { PADRAO } from "@/lib/candidatura-teste/padrao";
import type { RespostaDisc, Respostas } from "@/lib/candidatura-teste/perguntas";

// Exemplo do documento do Daniel (30/09/2026)
const respostas: Respostas = {
  contatos_semana: "mais100", publico_feminino: "quase_todas", onde_pretende_vender: ["trabalho", "igreja"],
  experiencia_venda: "nunca", contatos_whatsapp: "101a200", horas_semana: "7a15",
  o1: "anota", o2: "amiga", o3: "em_dia", o4: "devolvo", o5: "conta_anoto", restricao_declarada: "naosei",
  frases: { l1: 4, l2: 4, l3: 2, l4: 4, l5: 3, l6: 3, l7: 3, l8: 3 },
};
const disc: RespostaDisc[] = [
  ...Array.from({ length: 5 }, () => ({ mais: "C", menos: "D" }) as RespostaDisc),
  { mais: "C", menos: "I" },
  ...Array.from({ length: 4 }, () => ({ mais: "S", menos: "I" }) as RespostaDisc),
  ...Array.from({ length: 5 }, () => [{ mais: "S", menos: "C" }, { mais: "C", menos: "S" }] as RespostaDisc[]).flat(),
];

describe("teste de candidatura — exemplo do documento", () => {
  const r = calcular(respostas, disc, PADRAO);
  test("DISC bruto D −5, I −5, S +4, C +6", () => expect(r.disc).toEqual({ D: -5, I: -5, S: 4, C: 6 }));
  test("Rede 65 (alta)", () => { expect(r.rp).toBe(65); expect(r.rp_faixa).toBe("alta"); });
  test("Disciplina 75, Iniciativa 50", () => { expect(r.disciplina).toBe(75); expect(r.iniciativa).toBe(50); });
  test("Aptidão 41 (baixa)", () => { expect(r.av).toBe(41); expect(r.av_faixa).toBe("baixa"); });
  test("Organização 78 e IOA 77 (risco baixo)", () => { expect(r.o_soma).toBe(78); expect(r.ioa).toBe(77); expect(r.risco_acerto).toBe("baixo"); });
  test("Semáforo verde pela rede alta", () => { expect(r.semaforo_base).toBe("verde"); expect(r.semaforo_final).toBe("verde"); });
  test("IPL 55,4 e critério Público = 2", () => { expect(r.ipl).toBe(55.4); expect(r.publico_sugerido).toBe(2); });
});

describe("regras", () => {
  test("ajuste +15 da analista soma na rede, máximo 100", () => {
    expect(calcular(respostas, disc, PADRAO, { ajuste: true }).rp).toBe(80);
  });
  test("risco alto rebaixa verde para amarelo", () => {
    const r = calcular({ ...respostas, o2: "quando_puder", o3: "varias" }, disc, PADRAO);
    expect(r.risco_acerto).toBe("alto");
    expect(r.semaforo_base).toBe("verde");
    expect(r.semaforo_final).toBe("amarelo");
    expect(r.alertas).toContain("critico_o2");
  });
  test("semáforo: rede baixa e aptidão média = vermelho; rede média e aptidão alta = verde", () => {
    expect(semaforo("baixa", "media")).toBe("vermelho");
    expect(semaforo("media", "alta")).toBe("verde");
    expect(semaforo("baixa", "alta")).toBe("amarelo");
  });
  test("perfil: empate desempata na ordem I, S, D, C; secundário só se > 0", () => {
    expect(perfilDisc({ D: 3, I: 3, S: -6, C: 0 }).perfil).toBe("I+D");
    expect(perfilDisc({ D: -2, I: 4, S: -1, C: -1 }).perfil).toBe("I");
  });
  test("resposta rápida demais (< 120 s) gera alerta", () => {
    const r = calcular(respostas, disc, PADRAO, { discInicio: "2026-11-11T10:00:00Z", discFim: "2026-11-11T10:01:30Z" });
    expect(r.alertas).toContain("disc_rapido");
  });
});
