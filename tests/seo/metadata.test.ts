import { describe, expect, it } from "vitest";
import { seoTexts } from "../../src/lib/seo-texts";
import { robotsTxt, CAMINHOS_PRIVADOS, CAMINHOS_LIBERADOS } from "../../src/lib/public-text";
import { pageMeta } from "../../src/lib/seo";

describe("SEO limits without editing source content", () => {
  it("caps a dynamic title at 60 characters", () => {
    const input = { title: "Semijoias " + "catálogo ".repeat(20), description: "Peça publicada.", path: "/produto/peca" };
    const result = seoTexts(input);
    expect(result.title.length).toBeLessThanOrEqual(60);
    expect(result.title.startsWith("Semijoias")).toBe(true);
    expect(input.title.length).toBeGreaterThan(60);
  });
  it("keeps short descriptions between 120 and 155 characters", () => {
    for (const description of ["", "Peça publicada.", "Peça publicada no catálogo oficial de semijoias."]) {
      const result = seoTexts({ title: "Semijoias", description, path: "/produto/peca" });
      expect(result.description.length).toBeGreaterThanOrEqual(120);
      expect(result.description.length).toBeLessThanOrEqual(155);
    }
  });
  it("caps long descriptions at 155 characters", () => {
    expect(seoTexts({ title: "Semijoias", description: "Semijoias ".repeat(40), path: "/produto/peca" }).description.length).toBeLessThanOrEqual(155);
  });
  it("synchronizes social metadata with the page metadata", () => {
    const tags = pageMeta({ title: "Semijoias ".repeat(10), description: "Catálogo oficial.", path: "/produto/peca" });
    const get = (key: string) => tags.find(t => ("name" in t && t.name === key) || ("property" in t && t.property === key));
    expect(get("og:title")).toMatchObject({ content: tags[0]?.title });
    expect(get("twitter:title")).toMatchObject({ content: tags[0]?.title });
    expect(get("twitter:description")).toMatchObject({ content: get("description")?.content });
    expect(get("og:description")).toMatchObject({ content: get("description")?.content });
  });
  it("preserves restrictions and uses the same group for every requested crawler", () => {
    const robots = robotsTxt();
    for (const path of CAMINHOS_PRIVADOS) expect(robots).toContain(`Disallow: ${path}\n`);
    for (const path of CAMINHOS_LIBERADOS) expect(robots).toContain(`Allow: ${path}\n`);
    for (const bot of ["*", "Bingbot", "GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "Claude-User", "Google-Extended", "Applebot-Extended"]) {
      expect(robots.split("Allow: /")[0]).toContain(`User-agent: ${bot}\n`);
    }
  });
});