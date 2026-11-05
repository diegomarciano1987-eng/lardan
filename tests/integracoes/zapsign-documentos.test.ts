import { afterEach, describe, expect, it, vi } from "vitest";
import { baixarPdfAssinado } from "@/lib/zapsign/documentos.server";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("PDF assinado privado", () => {
  it("recusa HTTP, credenciais e destinos internos antes da rede", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const url of ["http://storage.googleapis.com/a.pdf", "https://127.0.0.1/a.pdf", "https://evil.test/a.pdf", "https://user:pass@storage.googleapis.com/a.pdf"]) {
      await expect(baixarPdfAssinado(url)).rejects.toThrow("não autorizado");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("baixa PDF sem redirecionar e com prazo máximo", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("%PDF-1.7\nprova")); vi.stubGlobal("fetch", fetcher);
    expect(new TextDecoder().decode(await baixarPdfAssinado("https://storage.googleapis.com/zapsign/prova.pdf"))).toBe("%PDF-1.7\nprova");
    expect(fetcher).toHaveBeenCalledWith("https://storage.googleapis.com/zapsign/prova.pdf", expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
  });
  it("recusa conteúdo que não é PDF", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>erro</html>")));
    await expect(baixarPdfAssinado("https://storage.googleapis.com/zapsign/prova.pdf")).rejects.toThrow("não é PDF");
  });
  it("recusa arquivos maiores que 20 MB", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("%PDF-", { headers: { "content-length": String(20 * 1024 * 1024 + 1) } })));
    await expect(baixarPdfAssinado("https://storage.googleapis.com/zapsign/prova.pdf")).rejects.toThrow("20 MB");
  });
  it("não devolve corpo de erro do provedor", async () => {
    vi.stubEnv("ZAPSIGN_API_TOKEN", "token-sintetico");
    vi.stubEnv("ZAPSIGN_AMBIENTE", "producao");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "token-sintetico" }), { status: 500 })));
    const { listarDocumentos } = await import("@/lib/zapsign/api.server");
    await expect(listarDocumentos(1)).rejects.toThrow("A ZapSign recusou a consulta (500).");
  });
});