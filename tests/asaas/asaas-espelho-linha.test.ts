import { describe, expect, it } from "vitest";
import { precisaBuscarNoAsaas } from "@/lib/asaas-automatico";

describe("0376: cobrança fora do espelho é buscada no Asaas", () => {
  it("reconhece o código da cobrança no aviso do banco", () => {
    expect(precisaBuscarNoAsaas("A cobrança pay_uqvz8v69tb57bbk0 ainda não chegou ao espelho do Asaas: busque as cobranças e tente de novo.")).toBe("pay_uqvz8v69tb57bbk0");
  });
  it("não busca para outros erros", () => {
    expect(precisaBuscarNoAsaas("Escolha quem pagou.")).toBeNull();
  });
});
