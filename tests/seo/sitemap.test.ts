import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/lib/storefront", () => ({ listPublicCategories: vi.fn(), listPublicProducts: vi.fn() }));
import { listPublicCategories, listPublicProducts } from "../../src/lib/storefront";
import { contarArquivosProdutos, urlsPaginas, slugsProdutos, xmlUrlset } from "../../src/lib/sitemap";

describe("Honest sitemap", () => {
  it("includes every published category even without published products, without inventing dates", async () => {
    const slugs = ["brincos", "colares", "aneis", "pulseiras"];
    vi.mocked(listPublicCategories).mockResolvedValueOnce(slugs.map((slug, ordem) => ({
      id: slug, slug, name: slug, description: null, ordem, produtos: 0,
    })));
    const urls = await urlsPaginas();
    for (const slug of slugs) {
      expect(urls).toContainEqual({ loc: `/semijoias/${slug}` });
    }
    expect(xmlUrlset(urls.filter((url) => url.loc.startsWith("/semijoias/")))).not.toContain("<lastmod>");
  });
  it("lists only the consolidated guide, not its permanent redirect", async () => {
    vi.mocked(listPublicCategories).mockResolvedValueOnce([]);
    const urls = await urlsPaginas();
    expect(urls).toContainEqual({ loc: "/guia/semijoia-folheado-ou-bijuteria", lastmod: "2026-10-25" });
    expect(urls.some((url) => url.loc === "/semijoia-folheado-ou-bijuteria")).toBe(false);
  });
  it("omits product files from the index when there are no public products", async () => {
    vi.mocked(listPublicProducts).mockResolvedValueOnce({ rows: [], total: 0 });
    expect(await contarArquivosProdutos()).toBe(0);
  });
  it.each([[1, 1], [5000, 1], [5001, 2]])("counts files for %i public products as %i", async (total, expected) => {
    vi.mocked(listPublicProducts).mockResolvedValueOnce({ rows: [], total });
    expect(await contarArquivosProdutos()).toBe(expected);
  });
  it("reads all published product URLs through pagination", async () => {
    const first = Array.from({ length: 500 }, (_, index) => ({ slug: `peca-${index}` }));
    vi.mocked(listPublicProducts)
      .mockResolvedValueOnce({ rows: first as Awaited<ReturnType<typeof listPublicProducts>>["rows"], total: 501 })
      .mockResolvedValueOnce({ rows: [{ slug: "ultima-peca" }] as Awaited<ReturnType<typeof listPublicProducts>>["rows"], total: 501 });
    const slugs = await slugsProdutos();
    expect(slugs).toHaveLength(501);
    expect(slugs[500]).toBe("ultima-peca");
    expect(listPublicProducts).toHaveBeenLastCalledWith({ pagina: 1, porPagina: 500 });
  });
  it("never invents lastmod for undated pages", () => {
    expect(xmlUrlset([{ loc: "/" }])).not.toContain("<lastmod>");
  });
  it("preserves authoritative page dates", () => {
    expect(xmlUrlset([{ loc: "/privacidade", lastmod: "2026-10-05" }])).toContain("<lastmod>2026-10-05</lastmod>");
  });
  it("does not silently omit categories when reading fails", async () => {
    vi.mocked(listPublicCategories).mockRejectedValueOnce(new Error("read failed"));
    await expect(urlsPaginas()).rejects.toThrow("read failed");
  });
  it("does not return a partial index when counting fails", async () => {
    vi.mocked(listPublicProducts).mockRejectedValueOnce(new Error("read failed"));
    await expect(contarArquivosProdutos()).rejects.toThrow("read failed");
  });
  it("does not silently truncate products when a batch is empty", async () => {
    vi.mocked(listPublicProducts).mockResolvedValueOnce({ rows: [], total: 100 });
    await expect(slugsProdutos()).rejects.toThrow("Catálogo incompleto");
  });
});