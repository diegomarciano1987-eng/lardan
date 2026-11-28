import { afterEach, beforeEach, expect, it, vi } from "vitest";

const permission = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../src/lib/ad-consent", () => ({ permitsOrdinaryAds: permission }));
let append: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  permission.mockResolvedValue(true);
  append = vi.fn(); reload = vi.fn(); assign = vi.fn();
  vi.stubGlobal("window", { dataLayer: [], gtag: vi.fn(), location: { reload, assign } });
  vi.stubGlobal("document", { querySelector: () => null, createElement: () => ({ dataset: {} }), head: { appendChild: append } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("installs the requested container once", async () => {
  const { initGoogleTagManager } = await import("../../src/lib/google-tag-manager");
  await initGoogleTagManager("/");
  await initGoogleTagManager("/contato");
  expect(append).toHaveBeenCalledTimes(1);
  expect(append.mock.calls[0]?.[0]).toMatchObject({ src: "https://www.googletagmanager.com/gtm.js?id=GTM-WK8WWR2R", defer: true });
});
it.each(["/admin", "/consultora", "/representante", "/equipe", "/documentos/token", "/candidatura/token", "/pedido/token", "/d/token"])("never installs in %s", async path => {
  await (await import("../../src/lib/google-tag-manager")).initGoogleTagManager(path);
  expect(append).not.toHaveBeenCalled();
});
it("refused consent blocks the container", async () => {
  permission.mockResolvedValue(false);
  await (await import("../../src/lib/google-tag-manager")).initGoogleTagManager("/");
  expect(append).not.toHaveBeenCalled();
});
it("withdrawal unloads the installed container with a fresh document", async () => {
  const { initGoogleTagManager, refreshGoogleTagPermission } = await import("../../src/lib/google-tag-manager");
  await initGoogleTagManager("/");
  permission.mockResolvedValue(false);
  await refreshGoogleTagPermission("/");
  expect(reload).toHaveBeenCalledTimes(1);
});
it("entering ERP removes the container before private-page tracking", async () => {
  const { initGoogleTagManager, setGoogleTagRoute } = await import("../../src/lib/google-tag-manager");
  await initGoogleTagManager("/");
  setGoogleTagRoute("/equipe");
  expect(assign).toHaveBeenCalledWith("/equipe");
});