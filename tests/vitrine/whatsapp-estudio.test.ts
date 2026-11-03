/**
 * Regra do campo WhatsApp no Estúdio da vitrine:
 * 1. Nunca exibe o +55 cru — cola com código do país e sai formatado (DD) NNNNN-NNNN.
 * 2. Recado amigável quando falta algo: DDD + 9 dígitos, DDD inexistente ou não-celular.
 */
import { describe, expect, it } from "vitest";
import { formatarTelefone, normalizarWhatsapp } from "../../src/lib/br/canonico";

describe("máscara do WhatsApp no Estúdio", () => {
  it("cola com +55 e mostra só o número nacional formatado", () => {
    expect(formatarTelefone("+55 18 98819-3119")).toBe("(18) 98819-3119");
    expect(formatarTelefone("5543999999999")).toBe("(43) 99999-9999");
  });

  it("formata aos poucos enquanto a consultora digita", () => {
    expect(formatarTelefone("43")).toBe("(43");
    expect(formatarTelefone("439")).toBe("(43) 9");
    expect(formatarTelefone("43999999999")).toBe("(43) 99999-9999");
  });

  it("número incompleto dá recado amigável, não erro seco", () => {
    const r = normalizarWhatsapp("43 9999");
    expect(r.estado).toBe("incompleto");
    expect(r.erro).toBe("WhatsApp incompleto: DDD + 9 dígitos.");
  });

  it("DDD inexistente e fixo em campo de celular dão recado claro", () => {
    expect(normalizarWhatsapp("10999999999").erro).toBe("DDD inexistente no Brasil.");
    expect(normalizarWhatsapp("43333333333").erro).toBe("WhatsApp precisa ser celular: o número começa com 9.");
  });

  it("celular válido passa e guarda o número em E.164 para o link da vitrine", () => {
    const r = normalizarWhatsapp("(43) 99999-9999");
    expect(r.estado).toBe("valido");
    expect(r.canonico).toBe("+5543999999999");
  });
});
