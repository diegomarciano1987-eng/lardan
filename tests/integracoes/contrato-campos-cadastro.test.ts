import { describe, expect, it } from "vitest";
import { preencherModelo, valoresDosCampos, type CamposAssinatura } from "@/lib/zapsign/modelo";

const base: CamposAssinatura = {
  nome: "MARIA TESTE", cpf: "123.456.789-09", endereco: "Rua A, 10", bairro: "Centro", cidade: "Assis/SP", cep: "19800-000",
  whatsapp: "18999999999", representante: "Rep", praca: "Assis", maleta: "", remessa: "",
};

describe("contrato: {{email}}, {{rg}}, {{estado_civil}}, {{data_nascimento}} vêm do cadastro", () => {
  it("preenche os quatro campos exatamente como no cadastro", () => {
    const v = valoresDosCampos({ ...base, email: "maria@x.com", rg: "12.345.678-9 SSP/SP", estado_civil: "Casada", data_nascimento: "1980-03-07" });
    const t = preencherModelo("{{email}}|{{rg}}|{{estado_civil}}|{{data_nascimento}}", v);
    expect(t).toBe("maria@x.com|12.345.678-9 SSP/SP|Casada|07/03/1980");
  });
  it("campo vazio no cadastro sai como linha em branco, nunca {{campo}}", () => {
    const t = preencherModelo("{{rg}} {{data_nascimento}}", valoresDosCampos(base));
    expect(t).toBe("________________ ________________");
  });
});
