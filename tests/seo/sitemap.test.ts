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
  it("discovers the new guide without removing the existing article", async () => {
    vi.mocked(listPublicCategories).mockResolvedValueOnce([]);
    const urls = await urlsPaginas();
    expect(urls).toContainEqual({ loc: "/guia/semijoia-folheado-ou-bijuteria", lastmod: "2026-10-25" });
    expect(urls).toContainEqual({ loc: "/semijoia-folheado-ou-bijuteria", lastmod: "2026-10-05" });
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