import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveOperationalTheme } from "../../src/lib/operational-theme";

describe("tema do sistema privado", () => {
  it("abre sempre no escuro quando não há escolha salva", () => {
    expect(resolveOperationalTheme(null)).toBe("dark");
    expect(resolveOperationalTheme(undefined)).toBe("dark");
    expect(resolveOperationalTheme("")).toBe("dark");
  });
  it("só usa o claro quando a escolha salva é exatamente 'light'", () => {
    expect(resolveOperationalTheme("light")).toBe("light");
    expect(resolveOperationalTheme("dark")).toBe("dark");
    expect(resolveOperationalTheme("LIGHT")).toBe("dark");
    expect(resolveOperationalTheme("qualquer-coisa")).toBe("dark");
  });
  it("mantém o escuro como tema base no CSS e oferece o claro como variante", () => {
    const css = readFileSync(resolve(__dirname, "../../src/operational-glass.css"), "utf8");
    const base = css.slice(0, css.indexOf("operational-glass-light"));
    expect(base).toContain("color-scheme: dark");
    expect(css).toContain(".operational-glass.operational-glass-light");
    expect(css).toContain("body.operational-glass-light-active");
    expect(css).toContain(".operational-glass-light::before");
  });
});
