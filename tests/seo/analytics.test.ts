import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Public Analytics isolation", () => {
  it.each(["/admin", "/admin/maletas/872", "/consultora", "/consultora-manual", "/consultora-garantia/1", "/representante", "/financeiro/simulacao/1", "/pdv", "/acesso", "/equipe", "/convite/token", "/minha-conta", "/redefinir-senha", "/api/public/ga-config"])("excludes %s from the public ID", async (path) => {
    const { isPublicAnalyticsPath } = await import("../../src/lib/analytics");
    expect(isPublicAnalyticsPath(path)).toBe(false);
  });

  it.each(["/", "/seja-lardan", "/semijoias/aneis", "/produto/brinco", "/ana-consultora", "/indicacao/abcd", "/contato", "/carrinho"])("keeps the public page %s eligible", async (path) => {
    const { isPublicAnalyticsPath } = await import("../../src/lib/analytics");
    expect(isPublicAnalyticsPath(path)).toBe(true);
  });

  it("loads nothing in ERP, sends one initial public view and disables events when returning to ERP", async () => {
    vi.resetModules();
    const fetchConfig = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "G-PUBLIC-TEST" }) });
    const appendChild = vi.fn();
    const browser: Record<string, unknown> = { location: { href: "https://www.lardan.com.br/seja-lardan" } };
    vi.stubGlobal("window", browser);
    vi.stubGlobal("fetch", fetchConfig);
    vi.stubGlobal("document", { querySelector: () => appendChild.mock.calls.length ? {} : null, createElement: () => ({ dataset: {} }), head: { appendChild }, title: "Lardan", referrer: "https://www.lardan.com.br/admin" });
    const { trackPageView, setAnalyticsRoute } = await import("../../src/lib/analytics");
    await trackPageView("/admin");
    expect(fetchConfig).not.toHaveBeenCalled();
    await trackPageView("/seja-lardan");
    expect(appendChild).toHaveBeenCalledTimes(1);
    const commands = () => (browser.dataLayer as Array<IArguments>).map(args => Array.from(args));
    expect(commands().filter(c => c[1] === "page_view")).toHaveLength(1);
    expect(commands().find(c => c[0] === "config")?.[2]).toEqual({ send_page_view: false });
    expect(commands().find(c => c[1] === "page_view")?.[2]).toMatchObject({ page_path: "/seja-lardan", page_referrer: "", send_to: "G-PUBLIC-TEST" });
    setAnalyticsRoute("/consultora");
    expect(browser["ga-disable-G-PUBLIC-TEST"]).toBe(true);
    await trackPageView("/consultora");
    expect(commands().filter(c => c[1] === "page_view")).toHaveLength(1);
    await trackPageView("/contato");
    expect(browser["ga-disable-G-PUBLIC-TEST"]).toBe(false);
    expect(commands().filter(c => c[1] === "page_view")).toHaveLength(2);
    expect(appendChild).toHaveBeenCalledTimes(1);
  });

  it("does not inject GA if a public config request completes inside ERP", async () => {
    vi.resetModules();
    let complete: ((value: unknown) => void) | undefined;
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { complete = resolve; })));
    const appendChild = vi.fn();
    vi.stubGlobal("document", { querySelector: () => null, createElement: () => ({ dataset: {} }), head: { appendChild } });
    const { trackPageView, setAnalyticsRoute } = await import("../../src/lib/analytics");
    const pending = trackPageView("/seja-lardan");
    setAnalyticsRoute("/admin");
    if (!complete) throw new Error("Expected config request");
    complete({ ok: true, json: async () => ({ id: "G-PUBLIC-TEST" }) });
    await pending;
    expect(appendChild).not.toHaveBeenCalled();
  });
});