import { describe, expect, it } from "vitest";
import { avisoPt, erroPt, pareceIngles } from "./aviso-pt";

describe("avisos sempre em português (0300)", () => {
  it("falha de internet do iPhone e do Android vira português", () => {
    expect(avisoPt("Load failed")).toBe("Sem conexão com a internet agora. Confira o sinal e tente de novo.");
    expect(avisoPt("TypeError: Failed to fetch")).toBe("Sem conexão com a internet agora. Confira o sinal e tente de novo.");
  });
  it("sessão vencida vira português", () => {
    expect(avisoPt("JWT expired")).toBe("Sua sessão expirou. Entre de novo para continuar.");
  });
  it("erro de permissão do banco vira português", () => {
    expect(avisoPt('permission denied for function rep_x')).toBe("Você não tem permissão para esta ação.");
  });
  it("inglês desconhecido nunca passa: vira aviso genérico", () => {
    expect(avisoPt("Something went wrong with signer")).toBe("Não foi possível concluir agora. Tente de novo; se repetir, avise a Lardan.");
  });
  it("texto em português passa sem mudança", () => {
    expect(avisoPt("Maleta MAL-00359 agora é de Leila.")).toBe("Maleta MAL-00359 agora é de Leila.");
    expect(avisoPt("Não encontrei a cobrança.")).toBe("Não encontrei a cobrança.");
    expect(pareceIngles("Recebimento confirmado.")).toBe(false);
  });
  it("erroPt lê Error, texto e objeto do banco", () => {
    expect(erroPt(new Error("Failed to fetch"))).toMatch(/^Sem conexão/);
    expect(erroPt({ message: "duplicate key value violates unique constraint" })).toBe("Este registro já existe.");
    expect(erroPt(null)).toBe("Não foi possível concluir agora. Tente de novo.");
  });
});
