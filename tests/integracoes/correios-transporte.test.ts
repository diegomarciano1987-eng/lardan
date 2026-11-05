import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resposta = (dados: unknown, status = 200) => new Response(JSON.stringify(dados), { status });

describe("Correios etapa 1 — consultas sem postagem", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [nome, valor] of Object.entries({ CORREIOS_USUARIO: "usuario-ficticio", CORREIOS_CODIGO_ACESSO: "codigo-ficticio", CORREIOS_CARTAO: "0000000000", CORREIOS_CONTRATO: "0000000000", CORREIOS_DR: "36", CORREIOS_AMBIENTE: "homologacao", CORREIOS_CEP_ORIGEM: "86200055" })) vi.stubEnv(nome, valor);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("não chama a rede sem código de acesso", async () => {
    vi.stubEnv("CORREIOS_CODIGO_ACESSO", "");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const api = await import("@/lib/correios/api.server");
    await expect(api.token()).rejects.toThrow("CORREIOS_CODIGO_ACESSO");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("homologação não usa o endereço de produção", async () => {
    const api = await import("@/lib/correios/api.server");
    expect(api.configCorreios().base).toBe("https://apihom.correios.com.br");
  });
  it("produção usa exclusivamente o endereço de produção", async () => {
    vi.stubEnv("CORREIOS_AMBIENTE", "producao");
    const api = await import("@/lib/correios/api.server");
    expect(api.configCorreios().base).toBe("https://api.correios.com.br");
  });
  it("reutiliza token e não retorna segredo no diagnóstico de autenticação", async () => {
    const fetcher = vi.fn().mockResolvedValue(resposta({ token: "ficticio", expiraEm: new Date(Date.now() + 3600000).toISOString(), codigo: "segredo-ficticio" })); vi.stubGlobal("fetch", fetcher);
    const api = await import("@/lib/correios/api.server");
    const t = await api.token(); await api.token();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(t.resposta)).not.toContain("ficticio");
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it("troca de credencial invalida o token anterior", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(resposta({ token: "ficticio" }))); vi.stubGlobal("fetch", fetcher);
    const api = await import("@/lib/correios/api.server");
    await api.token(); vi.stubEnv("CORREIOS_CODIGO_ACESSO", "outro-ficticio"); await api.token();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("caixa 40×30×10 cm, 1 kg; preço é consulta GET sem pré-postagem", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(resposta({ token: "ficticio" })).mockResolvedValueOnce(resposta({ pcFinal: "20.00" })); vi.stubGlobal("fetch", fetcher);
    const api = await import("@/lib/correios/api.server");
    await api.preco("03298", "15520011");
    const url = new URL(fetcher.mock.calls[1][0]);
    expect(url.pathname).toBe("/preco/v1/nacional/03298");
    expect(fetcher.mock.calls[1][1].method).toBe("GET");
    for (const [k, v] of Object.entries({ comprimento: "40", largura: "30", altura: "10", psObjeto: "1000" })) expect(url.searchParams.get(k)).toBe(v);
  });
  it("erros do provedor não devolvem o corpo nem credenciais", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta({ mensagem: "segredo-ficticio" }, 401)));
    const api = await import("@/lib/correios/api.server");
    await expect(api.token()).rejects.toThrow("Autenticação recusada pelos Correios (401)");
    try { await api.token(); } catch (e) { expect(JSON.stringify(e)).not.toContain("segredo-ficticio"); }
  });
});