import { test, expect } from "bun:test";
import { avisoFaltando } from "@/components/consultora/AppConsultora";
test("lista os 3 campos obrigatórios que faltam", () => {
  expect(avisoFaltando({ nome: "x", telefone: "x", aniversario: "x" })).toBe("Quase lá! Ainda não salvou: falta preencher corretamente o nome, o telefone / WhatsApp e a data de nascimento.");
});
test("só a data de nascimento", () => {
  expect(avisoFaltando({ aniversario: "x" })).toBe("Quase lá! Ainda não salvou: falta preencher corretamente a data de nascimento.");
});
test("sem erros não avisa", () => { expect(avisoFaltando({})).toBeNull(); });
