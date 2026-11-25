import { describe, expect, it } from "vitest";
import { alvaraConfere, meioDoExtrato, sugerirFormaDoExtrato } from "../../src/lib/forma-extrato";

const formas = [
  { id: "boleto", nome: "Boleto bancário" },
  { id: "misto", nome: "Dinheiro / Cobrança PIX" },
  { id: "pix", nome: "Cobrança PIX" },
  { id: "ted", nome: "Transferência bancária" },
];
describe("meio efetivo do extrato", () => {
  it("Pix de R$ 200 prevalece sobre boleto aprendido, sem escolher forma mista", () => {
    expect(sugerirFormaDoExtrato("PIX RECEBIDO 00072894997", formas, "boleto")).toBe("pix");
  });
  it("TED judicial prevalece sobre boleto aprendido", () => {
    expect(sugerirFormaDoExtrato("TED LIBERACAO RECURSO JUDICAIL", formas, "boleto")).toBe("ted");
  });
  it("não troca TED por depósito nem boleto se a forma não estiver cadastrada", () => {
    expect(sugerirFormaDoExtrato("TED LIBERACAO", formas.filter((f) => f.id !== "ted"), "boleto")).toBe("");
  });
  it("reconhece PIX, pix e transferência com acento", () => {
    expect(meioDoExtrato("pix recebido")).toBe("pix");
    expect(meioDoExtrato("TRANSFERÊNCIA RECEBIDA")).toBe("transferencia");
  });
  it("sem evidência e sem aprendizado válido permanece não informado", () => {
    expect(sugerirFormaDoExtrato("Lançamento bancário", formas)).toBe("");
  });
});
describe("alvará de Jheniffer", () => {
  it("R$ 302,63 + R$ 10,38 de juros confirmados fecham o TED R$ 313,01", () => {
    expect(alvaraConfere(31301, 30263, 1038)).toBe(true);
    expect(alvaraConfere(31301, 30263, 0)).toBe(false);
    expect(alvaraConfere(31301, 30263, 1037)).toBe(false);
  });
});