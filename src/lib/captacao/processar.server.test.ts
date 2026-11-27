import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processarLeadAoConcluir } from "./processar.server";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), consultar: vi.fn(), select: vi.fn(), update: vi.fn(),
  eq: vi.fn(), is: vi.fn(), lte: vi.fn(), from: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock("@/lib/credito/credito.functions", () => ({ consultarCreditoDaCandidata: mocks.consultar }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-27T15:04:00Z"));
  const chain = { update: mocks.update, eq: mocks.eq, is: mocks.is, lte: mocks.lte, select: mocks.select };
  for (const fn of [mocks.from, mocks.update, mocks.eq, mocks.is, mocks.lte]) fn.mockReturnValue(chain);
  mocks.select.mockResolvedValue({ data: [{ lead_id: "lead-1" }], error: null });
  mocks.consultar.mockResolvedValue({ reaproveitada: false, situacao: "ok" });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "captacao_decidir" ? { decisao: "aprovada_automatica" } : null, error: null }));
});
afterEach(() => vi.useRealTimers());

describe("0407 — decisão imediatamente após o teste", () => {
  it("reserva por exatamente 3 minutos antes de consultar e decidir", async () => {
    await processarLeadAoConcluir("lead-1");
    expect(mocks.update).toHaveBeenCalledWith({ proxima_em: "2026-11-27T15:07:00.000Z" });
    expect(mocks.consultar).toHaveBeenCalledWith("lead-1", "automatica", null, false);
    expect(mocks.rpc).toHaveBeenCalledWith("captacao_decidir", { _lead: "lead-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("captacao_fila_concluir", { _lead: "lead-1", _erro: null });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("não toma uma linha concluída ou já reservada pela rotina", async () => {
    mocks.select.mockResolvedValue({ data: [], error: null });
    await processarLeadAoConcluir("lead-1");
    expect(mocks.is).toHaveBeenCalledWith("feito_em", null);
    expect(mocks.eq).toHaveBeenCalledWith("tentativas", 0);
    expect(mocks.lte).toHaveBeenCalledWith("proxima_em", "2026-11-27T15:04:00.000Z");
    expect(mocks.consultar).not.toHaveBeenCalled();
  });
  it("não consulta se a reserva falha", async () => {
    mocks.select.mockResolvedValue({ data: null, error: { message: "indisponível" } });
    await expect(processarLeadAoConcluir("lead-1")).rejects.toThrow("reservar");
    expect(mocks.consultar).not.toHaveBeenCalled();
  });
  it("para de esperar aos 20 segundos e preserva a fila pendente", async () => {
    mocks.consultar.mockImplementation(() => new Promise(() => {}));
    let terminou = false;
    const promise = processarLeadAoConcluir("lead-1").then(() => { terminou = true; });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(terminou).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(terminou).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalledWith("captacao_fila_concluir", expect.anything());
    expect(vi.getTimerCount()).toBe(0);
  });
  it("falha de crédito volta para a rotina sem decidir", async () => {
    mocks.consultar.mockResolvedValue({ reaproveitada: false, situacao: "erro" });
    await processarLeadAoConcluir("lead-1");
    expect(mocks.rpc).not.toHaveBeenCalledWith("captacao_decidir", expect.anything());
    expect(mocks.rpc).toHaveBeenCalledWith("captacao_fila_concluir", { _lead: "lead-1", _erro: expect.any(String) });
  });
  it("CPF inválido vai para revisão humana, nunca para recusa", async () => {
    mocks.consultar.mockRejectedValue(new Error("Sem CPF válido"));
    await processarLeadAoConcluir("lead-1");
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["captacao_revisar", "captacao_fila_concluir"]);
    expect(mocks.rpc).toHaveBeenCalledWith("captacao_revisar", { _lead: "lead-1", _motivo: "Sem CPF válido" });
  });
});