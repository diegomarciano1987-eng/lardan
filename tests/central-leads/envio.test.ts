import { describe, it, expect } from "vitest";
import { classificar, atrasoMs } from "@/lib/central-leads.server";

describe("Central de Leads: respostas", () => {
  it("200 e 201 contam como recebido", () => {
    expect(classificar(200)).toBe("enviado");
    expect(classificar(201)).toBe("enviado");
  });
  it("429, 5xx e falha de rede retentam", () => {
    expect(classificar(429)).toBe("retentar");
    expect(classificar(503)).toBe("retentar");
    expect(classificar(0)).toBe("retentar");
  });
  it("400 vira erro registrado; 401 pausa a conexão", () => {
    expect(classificar(400)).toBe("erro");
    expect(classificar(401)).toBe("conexao");
  });
  it("backoff dobra e tem teto de 6 h", () => {
    expect(atrasoMs(1, 0.5)).toBe(60_000);
    expect(atrasoMs(3, 0.5)).toBe(240_000);
    expect(atrasoMs(50, 0.5)).toBe(6 * 3600_000);
  });
});
