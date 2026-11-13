/** 0306/0309 — espelho do cadastro Lardan → Asaas: regras puras (Diego 13/11/2026: só vale o Lardan, nada some do Asaas). */
import { describe, expect, test } from "bun:test";
import { comparar, normalizar, pendentes, resumoEspelho } from "../../src/lib/asaas/cliente-espelho";

const cacildaLardan = { name: "Cacilda da Luz", cpfCnpj: "06181892974", email: null, mobilePhone: "42999121933", phone: null,
  postalCode: "85200000", address: "Rua Guairaca", addressNumber: "1481", complement: null, province: "Maristela" };
const cacildaAsaas = { name: "CACILDA DA LUZ", cpfCnpj: "06181892974", email: null, mobilePhone: "5542999121933", phone: null,
  postalCode: "85200000", address: "RUA GUAIRACA", addressNumber: "1481", complement: null, province: "MARISTELA", notificationDisabled: false };

describe("espelho do cadastro", () => {
  test("Cacilda: maiúsculas, acento e 55 no celular não contam como diferença", () => {
    expect(comparar(cacildaLardan, cacildaAsaas)).toEqual({ enviar: {}, diferencas: [] });
  });
  test("celular novo no Lardan é enviado sem o 55", () => {
    const r = comparar({ ...cacildaLardan, mobilePhone: "42988887777" }, cacildaAsaas);
    expect(r.enviar).toEqual({ mobilePhone: "42988887777" });
  });
  test("o que só o Asaas tem nunca é apagado", () => {
    const r = comparar({ ...cacildaLardan, complement: null }, { ...cacildaAsaas, email: "ela@x.com", complement: "AP 2" });
    expect(r.enviar).toEqual({});
    expect(r.diferencas.map((d) => [d.campo, d.acao])).toEqual([["email", "so_no_asaas"], ["complement", "so_no_asaas"]]);
  });
  test("CPF diferente nunca é trocado sozinho", () => {
    const r = comparar(cacildaLardan, { ...cacildaAsaas, cpfCnpj: "11111111111" }, { forcar: true });
    expect(r.enviar.cpfCnpj).toBeUndefined();
    expect(r.diferencas[0]).toMatchObject({ campo: "cpfCnpj", acao: "conferir" });
  });
  test("só vale o Lardan: número que alguém pôs direto no Asaas é trocado pelo do Lardan", () => {
    const r = comparar(cacildaLardan, { ...cacildaAsaas, mobilePhone: "5543999553978" });
    expect(r.enviar).toEqual({ mobilePhone: "42999121933" });
    expect(pendentes(r.diferencas)).toEqual([]);
  });
  test("celular que também é de outra pessoa no Lardan vai mesmo assim, com aviso", () => {
    const r = comparar({ ...cacildaLardan, mobilePhone: "42988887777" }, cacildaAsaas, { celularCompartilhado: true });
    expect(r.enviar).toEqual({ mobilePhone: "42988887777" });
    expect(r.diferencas[0]?.nota).toContain("outra pessoa");
  });
  test("avisos desligados no Asaas ficam como estão e não contam como ponto para conferir", () => {
    const r = comparar(cacildaLardan, { ...cacildaAsaas, notificationDisabled: true });
    expect(r.enviar).toEqual({});
    expect(r.diferencas).toMatchObject([{ campo: "avisos", acao: "so_no_asaas" }]);
    expect(resumoEspelho("igual", r.diferencas)).toEqual({ texto: "Asaas igual ao Lardan", tom: "ok" });
  });
  test("mudou o CEP: vai o endereço inteiro do Lardan junto (o Asaas não completa sozinho)", () => {
    const r = comparar({ ...cacildaLardan, postalCode: "85200001" }, cacildaAsaas);
    expect(r.enviar).toEqual({ postalCode: "85200001", address: "Rua Guairaca", addressNumber: "1481", province: "Maristela" });
  });
  test("valores inválidos do Lardan não são enviados", () => {
    const r = comparar({ ...cacildaLardan, email: "sem-arroba", mobilePhone: "4299121933" }, { ...cacildaAsaas, mobilePhone: null });
    expect(r.enviar).toEqual({});
  });
  test("nome diferente no Asaas é trocado pelo do Lardan", () => {
    expect(comparar({ ...cacildaLardan, name: "Kauani Mendes da Costa" }, { ...cacildaAsaas, name: "KAWANY MENDES DA COSTA" }).enviar.name).toBe("Kauani Mendes da Costa");
    expect(comparar({ ...cacildaLardan, name: "Lucilene Fonseca da Cunha" }, { ...cacildaAsaas, name: "LUCILENE INOCENCIA" }).enviar.name).toBe("Lucilene Fonseca da Cunha");
  });
  test("S/N e telefone com 55", () => {
    expect(normalizar("addressNumber", "s/n")).toBe("S/N");
    expect(normalizar("mobilePhone", "+55 (42) 99912-1933")).toBe("42999121933");
  });
});
