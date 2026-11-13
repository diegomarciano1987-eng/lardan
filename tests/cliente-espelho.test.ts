/** 0306 — espelho do cadastro Lardan → Asaas: regras puras (Diego 13/11/2026: Lardan manda, nada some do Asaas). */
import { describe, expect, test } from "bun:test";
import { comparar, normalizar } from "../src/lib/asaas/cliente-espelho";

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
  test("primeira conferência: número que o Lardan não conhece fica para conferir; 'Usar o do Lardan' manda", () => {
    const asaas = { ...cacildaAsaas, mobilePhone: "5543999553978" };
    const r1 = comparar(cacildaLardan, asaas, { primeira: true, conhecidos: ["5542999121933"] });
    expect(r1.enviar).toEqual({});
    expect(r1.diferencas[0]).toMatchObject({ campo: "mobilePhone", acao: "conferir" });
    expect(comparar(cacildaLardan, asaas, { primeira: true, forcar: true }).enviar).toEqual({ mobilePhone: "42999121933" });
    // depois da primeira conferência, mudança no Lardan manda direto
    expect(comparar(cacildaLardan, asaas, { primeira: false }).enviar).toEqual({ mobilePhone: "42999121933" });
  });
  test("celular que também é de outra pessoa no Lardan não é enviado sem conferência", () => {
    const r = comparar({ ...cacildaLardan, mobilePhone: "42988887777" }, cacildaAsaas, { celularCompartilhado: true });
    expect(r.enviar).toEqual({});
  });
  test("mudou o CEP: vai o endereço inteiro do Lardan junto (o Asaas não completa sozinho)", () => {
    const r = comparar({ ...cacildaLardan, postalCode: "85200001" }, cacildaAsaas);
    expect(r.enviar).toEqual({ postalCode: "85200001", address: "Rua Guairaca", addressNumber: "1481", province: "Maristela" });
  });
  test("valores inválidos do Lardan não são enviados", () => {
    const r = comparar({ ...cacildaLardan, email: "sem-arroba", mobilePhone: "4299121933" }, { ...cacildaAsaas, mobilePhone: null });
    expect(r.enviar).toEqual({});
  });
  test("nome com erro de digitação é corrigido; nome muito diferente na primeira vez fica para conferir", () => {
    expect(comparar({ ...cacildaLardan, name: "Kauani Mendes da Costa" }, { ...cacildaAsaas, name: "KAWANY MENDES DA COSTA" }, { primeira: true }).enviar.name).toBe("Kauani Mendes da Costa");
    const r = comparar({ ...cacildaLardan, name: "Lucilene Fonseca da Cunha" }, { ...cacildaAsaas, name: "LUCILENE INOCENCIA" }, { primeira: true });
    expect(r.enviar.name).toBeUndefined();
  });
  test("S/N e telefone com 55", () => {
    expect(normalizar("addressNumber", "s/n")).toBe("S/N");
    expect(normalizar("mobilePhone", "+55 (42) 99912-1933")).toBe("42999121933");
  });
});
