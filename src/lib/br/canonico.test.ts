import { describe, expect, it } from "vitest";
import {
  cnpjValido,
  codigoBarrasValido,
  cpfValido,
  formatarCnpj,
  formatarCpf,
  normalizarCep,
  normalizarCnpj,
  normalizarCodigoBarras,
  normalizarCpf,
  normalizarDocumento,
  normalizarEmail,
  normalizarPix,
  normalizarTelefone,
  normalizarWhatsapp,
  tipoDocumento,
} from "./canonico";
import { ufValida } from "./ufs";

describe("CPF", () => {
  it("aceita CPF válido", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(normalizarCpf("529.982.247-25").canonico).toBe("52998224725");
  });
  it("recusa dígito verificador errado", () => {
    expect(normalizarCpf("529.982.247-24").estado).toBe("invalido");
  });
  it("recusa sequência repetida", () => {
    expect(cpfValido("00000000000")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
  });
  it("marca incompleto abaixo de 11 dígitos", () => {
    expect(normalizarCpf("5299822").estado).toBe("incompleto");
  });
  it("impede o 12º dígito", () => {
    expect(normalizarCpf("529982247259999").formatado).toBe("529.982.247-25");
  });
  it("aceita colagem com pontuação e preserva zeros à esquerda", () => {
    expect(normalizarCpf("012.345.678-90").canonico).toBe("01234567890");
    expect(formatarCpf("01234567890")).toBe("012.345.678-90");
  });
  it("permite vazio", () => {
    expect(normalizarCpf("").estado).toBe("vazio");
  });
});

describe("CNPJ", () => {
  it("aceita CNPJ numérico válido", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(normalizarCnpj("11.222.333/0001-81").canonico).toBe("11222333000181");
  });
  it("recusa CNPJ numérico inválido", () => {
    expect(cnpjValido("11222333000182")).toBe(false);
  });
  it("aceita CNPJ alfanumérico válido (fixture oficial)", () => {
    expect(cnpjValido("12ABC34501DE35")).toBe(true);
    expect(normalizarCnpj("12.ABC.345/01DE-35").canonico).toBe("12ABC34501DE35");
  });
  it("recusa alfanumérico com verificador errado", () => {
    expect(cnpjValido("12ABC34501DE36")).toBe(false);
  });
  it("normaliza minúsculas", () => {
    expect(normalizarCnpj("12abc34501de35").canonico).toBe("12ABC34501DE35");
  });
  it("descarta caractere proibido e limita a 14", () => {
    expect(normalizarCnpj("12ABC#34501DE35999").canonico).toBe("12ABC34501DE35");
  });
  it("exige verificadores numéricos", () => {
    expect(normalizarCnpj("12ABC34501DEAB").erro).toMatch(/números/);
  });
  it("formata alfanumérico com a pontuação padrão", () => {
    expect(formatarCnpj("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
  });
  it("permite vazio", () => {
    expect(normalizarCnpj("").estado).toBe("vazio");
  });
});

describe("documento único", () => {
  it("decide pelo conteúdo", () => {
    expect(tipoDocumento("52998224725")).toBe("cpf");
    expect(tipoDocumento("11222333000181")).toBe("cnpj");
    expect(tipoDocumento("12ABC34501DE35")).toBe("cnpj");
    expect(normalizarDocumento("11.222.333/0001-81").canonico).toBe("11222333000181");
  });
});

describe("CEP", () => {
  it("aceita 8 dígitos", () => {
    expect(normalizarCep("01001-000").canonico).toBe("01001000");
  });
  it("marca incompleto", () => {
    expect(normalizarCep("0100").estado).toBe("incompleto");
  });
  it("impede o 9º dígito e rejeita letras", () => {
    expect(normalizarCep("010010009").canonico).toBe("01001000");
    expect(normalizarCep("ABCDEFGH").estado).toBe("vazio");
  });
  it("permite vazio", () => {
    expect(normalizarCep("").estado).toBe("vazio");
  });
});

describe("WhatsApp", () => {
  it("aceita DDD + 9 dígitos", () => {
    expect(normalizarWhatsapp("(11) 99999-9999").canonico).toBe("+5511999999999");
  });
  it("não duplica o país ao colar +55", () => {
    expect(normalizarWhatsapp("+55 (11) 99999-9999").canonico).toBe("+5511999999999");
  });
  it("recusa DDD inválido", () => {
    expect(normalizarWhatsapp("(10) 99999-9999").estado).toBe("invalido");
  });
  it("recusa telefone fixo no campo WhatsApp", () => {
    expect(normalizarWhatsapp("(11) 3333-4444").estado).toBe("incompleto");
    expect(normalizarWhatsapp("(11) 33334-4444").erro).toMatch(/celular/);
  });
  it("descarta dígito excedente", () => {
    expect(normalizarWhatsapp("11999999999123").canonico).toBe("+5511999999999");
  });
  it("permite vazio", () => {
    expect(normalizarWhatsapp("").estado).toBe("vazio");
  });
});

describe("telefone alternativo", () => {
  it("aceita fixo e celular", () => {
    expect(normalizarTelefone("(11) 3333-4444").canonico).toBe("+551133334444");
    expect(normalizarTelefone("(11) 99999-9999").canonico).toBe("+5511999999999");
  });
  it("aplica máscara dinâmica", () => {
    expect(normalizarTelefone("1133334444").formatado).toBe("(11) 3333-4444");
    expect(normalizarTelefone("11999999999").formatado).toBe("(11) 99999-9999");
  });
  it("recusa formato inválido", () => {
    expect(normalizarTelefone("(11) 1111-1111").estado).toBe("invalido");
  });
});

describe("e-mail", () => {
  it("apara espaços e normaliza", () => {
    expect(normalizarEmail("  Contato@Lardan.com.br ").canonico).toBe("contato@lardan.com.br");
  });
  it("recusa formato inválido", () => {
    expect(normalizarEmail("contato@lardan").estado).toBe("invalido");
  });
  it("permite vazio", () => {
    expect(normalizarEmail("").estado).toBe("vazio");
  });
});

describe("PIX", () => {
  it("reutiliza os validadores canônicos", () => {
    expect(normalizarPix("cpf", "529.982.247-25").canonico).toBe("52998224725");
    expect(normalizarPix("cnpj", "12ABC34501DE35").canonico).toBe("12ABC34501DE35");
    expect(normalizarPix("telefone", "+5511999999999").canonico).toBe("+5511999999999");
    expect(normalizarPix("email", "a@b.com").canonico).toBe("a@b.com");
  });
  it("valida chave aleatória UUID", () => {
    expect(normalizarPix("aleatoria", "b5f9f0f7-2f4a-4c0a-9c93-1f7f0d6a1234").estado).toBe("valido");
    expect(normalizarPix("aleatoria", "123").estado).toBe("invalido");
  });
});

describe("código de barras", () => {
  it("valida EAN-13", () => {
    expect(codigoBarrasValido("7891234567895")).toBe(true);
    expect(normalizarCodigoBarras("7891234567890").estado).toBe("invalido");
  });
});

describe("UF", () => {
  it("aceita apenas UF brasileira", () => {
    expect(ufValida("sp")).toBe(true);
    expect(ufValida("XX")).toBe(false);
  });
});
