import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { centavos, lerPlanilhaJuridico } from "@/lib/planilha-juridico";

describe("planilha do jurídico", () => {
  it("converte valores em centavos", () => {
    expect(centavos(2011.6)).toBe(201160);
    expect(centavos("1.234,56")).toBe(123456);
    expect(centavos("A confirmar")).toBeNull();
    expect(centavos("")).toBeNull();
  });
  const f = "/mnt/user-uploads/PLANILHA_MESTRA_PROCESSOS_CIVIS.xlsx";
  it.skipIf(!existsSync(f))("lê a Base Geral real", () => {
    const b = readFileSync(f);
    const l = lerPlanilhaJuridico(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    expect(l.length).toBe(582);
    expect(l[0]!.nome).toBe("Aline Cristina Alves Batista");
    expect(l[0]!.cpf).toBe("09228509929");
    expect(l[0]!.valor_causa_cents).toBe(201160);
    expect(l[0]!.numero).toBe("0003054-66.2026.8.16.0090");
    expect(l[0]!.ultima_atualizacao).toBe("2026-08-13");
    expect(l.find((x) => x.cpf === "02692063961")!.numero).toBe("6000665-06.2026.8.16.0090");
    expect(l.filter((x) => x.id.startsWith("L")).length).toBe(63);
  });
});
