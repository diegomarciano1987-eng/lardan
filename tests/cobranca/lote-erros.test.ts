import { describe, it, expect } from "vitest";
import { erroAmigavel } from "@/lib/cobranca-lote-erros";

describe("erroAmigavel", () => {
  it("CPF ausente", () => expect(erroAmigavel("invalid_cpfCnpj")).toMatch(/CPF/));
  it("permissão", () => expect(erroAmigavel("Sem permissão de cobrança.")).toMatch(/permissão/));
  it("acordo excluído", () => expect(erroAmigavel("simulação não encontrada")).toMatch(/cancelado/));
  it("vazio", () => expect(erroAmigavel("")).toBe("Motivo não informado pelo Asaas."));
});
