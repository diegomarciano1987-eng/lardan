import { describe, expect, it } from "vitest";
import { llmsTxt } from "../../src/lib/public-text";
import { formatLlmsLinks } from "../../src/lib/llms-format";

describe("llms.txt public document rules", () => {
  it("cites only the consolidated comparison guide", () => {
    expect(llmsTxt()).toContain("https://www.lardan.com.br/guia/semijoia-folheado-ou-bijuteria");
    expect(llmsTxt()).not.toContain("https://www.lardan.com.br/semijoia-folheado-ou-bijuteria");
  });
  it("stays below 30000 characters", () => {
    expect(llmsTxt().length).toBeLessThan(30000);
  });
  it("records the requested UTC editorial date rather than request time", () => {
    expect(llmsTxt().match(/Última atualização: (\d{4}-\d{2}-\d{2})/)?.[1]).toBe("2026-10-25");
  });
  it("has 15 to 25 questions with complete Markdown destinations", () => {
    const questions = llmsTxt().split("\n").filter(line => line.includes("? →"));
    expect(questions.length).toBeGreaterThanOrEqual(15);
    expect(questions.length).toBeLessThanOrEqual(25);
    for (const line of questions) expect(line).toMatch(/^- .+\? → \[.+\]\(https:\/\/www\.lardan\.com\.br\/[^)]+\): .+$/);
  });
  it("converts every cited URL to a complete Markdown link", () => {
    const document = llmsTxt();
    const urls = [...document.matchAll(/https:\/\/[^\s)]+/g)];
    const links = [...document.matchAll(/\[[^\]]+\]\(https:\/\/[^\s)]+\): [^\n]+/g)];
    expect(urls.length).toBeGreaterThan(50);
    expect(links.length).toBe(urls.length);
  });
  it("preserves prose around a converted URL and is idempotent", () => {
    const source = "Texto preservado\nSite oficial: https://www.lardan.com.br\nOutro parágrafo";
    const result = formatLlmsLinks(source);
    expect(result.startsWith("Texto preservado\nSite oficial:\n- [")).toBe(true);
    expect(result.endsWith("\nOutro parágrafo")).toBe(true);
    expect(formatLlmsLinks(result)).toBe(result);
  });
});