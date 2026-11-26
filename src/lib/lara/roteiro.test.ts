// 0402 — roteiro da Lara: como ela entende a resposta e qual o próximo passo (sem banco e sem rede).
import { describe, expect, it } from "vitest";
import { decidir, juntar, ler, type Contexto } from "./roteiro";
import { BOTAO, MODELOS } from "./textos";

const ctx = (o: Partial<Contexto> = {}): Contexto => ({ estado: "msg1", humano: false, optOut: false, nome: "Maria", testeConcluido: false, soMidia: false, ...o });

describe("ler a resposta", () => {
  it("botões do modelo valem exatamente", () => {
    expect(ler(BOTAO.sim).intencao).toBe("sim");
    expect(ler(BOTAO.pensar).intencao).toBe("pensar");
    expect(ler(BOTAO.nao).intencao).toBe("nao");
    expect(ler(BOTAO.combinado).intencao).toBe("sim");
    expect(ler(BOTAO.revisao).revisao).toBe(true);
  });
  it("sim, não e pensar escritos do jeito dela", () => {
    for (const t of ["Sim", "siiim!", "Claro que sim", "tenho interesse sim", "Quero sim 😍", "ok", "Combinado", "quero"]) expect(ler(t).intencao).toBe("sim");
    for (const t of ["Não", "nao tenho interesse", "Não quero, obrigada", "desisti"]) expect(ler(t).intencao).toBe("nao");
    for (const t of ["vou pensar", "Não sei ainda", "agora não", "depois te falo"]) expect(ler(t).intencao).toBe("pensar");
  });
  it("'tenho uma dúvida' não vira sim", () => {
    const l = ler("tenho uma dúvida, quanto eu ganho?");
    expect(l.intencao).toBeNull();
    expect(l.duvida).toBe(true);
  });
  it("como conheceu", () => {
    expect(ler("Sim! Conheci pelo Instagram").comoConheceu).toBe("instagram");
    expect(ler("minha amiga me indicou").comoConheceu).toBe("indicacao");
    expect(ler("vi no google").comoConheceu).toBe("google");
    expect(ler("Sim! Conheci pelo Instagram").intencao).toBe("sim");
  });
  it("robô, pessoa, sair, revisão", () => {
    expect(ler("você é robô?").robo).toBe(true);
    expect(ler("isso é um bot?").robo).toBe(true);
    expect(ler("quero falar com uma pessoa").humano).toBe(true);
    expect(ler("pare de me mandar mensagem").sair).toBe(true);
    expect(ler("SAIR").sair).toBe(true);
    expect(ler("quero que revisem minha candidatura").revisao).toBe(true);
  });
  it("a IA só completa o que a regra não entendeu", () => {
    const nada = ler("hmm então né");
    expect(nada.entendeu).toBe(false);
    expect(juntar(nada, { intencao: "sim" }).intencao).toBe("sim");
    expect(juntar(ler("não"), { intencao: "sim" }).intencao).toBe("nao");
  });
});

describe("próximo passo", () => {
  it("mensagem 1 → sim → mensagem 2 com botões; guarda como conheceu", () => {
    const p = decidir(ctx(), ler("Sim! Vi no Instagram"));
    expect(p.estado).toBe("msg2");
    expect(p.enviar[0]).toMatchObject({ tipo: "botoes" });
    expect(p.comoConheceu).toBe("instagram");
  });
  it("mensagem 2 → combinado → link do teste e lembrete em 48 h; se já fez o teste, não manda link", () => {
    expect(decidir(ctx({ estado: "msg2" }), ler(BOTAO.combinado))).toMatchObject({ estado: "teste", proximaEmHoras: 48, enviar: [{ tipo: "link_teste", modelo: "msg3" }] });
    expect(decidir(ctx({ estado: "msg2", testeConcluido: true }), ler("sim")).estado).toBe("teste_feito");
  });
  it("não ou preciso pensar: agradece, não manda o teste; porta aberta depois", () => {
    expect(decidir(ctx(), ler(BOTAO.nao)).estado).toBe("desistiu");
    expect(decidir(ctx({ estado: "msg2" }), ler("vou pensar")).estado).toBe("pensando");
    expect(decidir(ctx({ estado: "pensando" }), ler("pensei, quero sim")).estado).toBe("msg2");
  });
  it("dúvida livre vai para uma pessoa (uma mensagem só) e a Lara para", () => {
    const p = decidir(ctx({ estado: "msg2" }), ler("quanto tempo demora pra maleta chegar?"));
    expect(p.humano).toBeTruthy();
    expect(p.enviar).toHaveLength(1);
    expect(decidir(ctx({ humano: true }), ler("oi?")).enviar).toEqual([]);
  });
  it("robô: diz a verdade e não muda o passo", () => {
    const p = decidir(ctx({ estado: "msg2" }), ler("vc é uma IA?"));
    expect(p.estado).toBeUndefined();
    expect((p.enviar[0] as { texto: string }).texto).toContain("assistente de IA");
  });
  it("sair: para tudo, nem a equipe manda depois", () => {
    expect(decidir(ctx(), ler("parar"))).toMatchObject({ optOut: true });
    expect(decidir(ctx({ optOut: true }), ler("sim")).enviar).toEqual([]);
  });
  it("durante o teste: pede o link de novo; dúvida vai para pessoa", () => {
    expect(decidir(ctx({ estado: "lembrete" }), ler("me manda o link de novo")).enviar[0]).toMatchObject({ tipo: "link_teste", modelo: "link_de_novo" });
    expect(decidir(ctx({ estado: "teste" }), ler("como faço a parte 3?")).humano).toBeTruthy();
  });
  it("recusada: pedir revisão registra; áudio pede texto", () => {
    expect(decidir(ctx({ estado: "recusada" }), ler(BOTAO.revisao)).revisao).toBe(true);
    expect(decidir(ctx({ soMidia: true }), ler("")).enviar[0]).toMatchObject({ tipo: "texto" });
  });
});

describe("modelos da Meta", () => {
  it("nenhuma variável no começo ou no fim; botões até 20 letras; nada de promessa de renda", () => {
    for (const m of MODELOS) {
      expect(m.corpo.trim().startsWith("{{")).toBe(false);
      expect(/\{\{\d\}\}[.!?]?$/.test(m.corpo.trim())).toBe(false);
      expect((m.corpo.match(/\{\{\d\}\}/g) ?? []).length).toBe(m.exemplo.length);
      for (const b of m.botoes) expect(b.texto.length).toBeLessThanOrEqual(20);
      expect(m.corpo).not.toMatch(/garant|renda de|ganhe R\$/i);
    }
  });
});
