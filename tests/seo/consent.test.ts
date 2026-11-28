import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const events = new EventTarget();
  vi.stubGlobal("window", Object.assign(events, { gtag: vi.fn() }));
  vi.stubGlobal("navigator", { globalPrivacyControl: false });
  vi.stubGlobal("location", { hostname: "www.lardan.com.br" });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function country(code: string) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => `h=www.lardan.com.br\nloc=${code}\n` })));
}

describe("Regional advertising consent", () => {
  it.each(["DE", "GB", "CH", "CA", "FR"])("requires advertising acceptance in %s", async code => {
    country(code);
    const { canTrack, needsAnswer } = await import("../../src/lib/consent");
    expect(await canTrack("advertising")).toBe(false);
    expect(await needsAnswer(["analytics", "advertising"])).toBe(true);
  });
  it("allows ordinary advertising in Brazil without a regional notice", async () => {
    country("BR");
    const { canTrack, needsAnswer } = await import("../../src/lib/consent");
    expect(await canTrack("advertising")).toBe(true);
    expect(await needsAnswer(["analytics", "advertising"])).toBe(false);
  });
  it("unknown location blocks advertising", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unavailable"); }));
    const { canTrack } = await import("../../src/lib/consent");
    expect(await canTrack("advertising")).toBe(false);
  });
  it("analytics permission never grants advertising", async () => {
    country("DE");
    const { canTrack, saveChoices } = await import("../../src/lib/consent");
    saveChoices({ analytics: "granted" });
    expect(await canTrack("analytics")).toBe(true);
    expect(await canTrack("advertising")).toBe(false);
  });
  it("refusal overrides Brazil and persists through the module reload", async () => {
    country("BR");
    const { saveChoices, canTrack } = await import("../../src/lib/consent");
    saveChoices({ advertising: "denied" });
    expect(await canTrack("advertising")).toBe(false);
    vi.resetModules();
    expect(await (await import("../../src/lib/consent")).canTrack("advertising")).toBe(false);
  });
  it("withdrawal replaces acceptance immediately", async () => {
    country("DE");
    const { saveChoices, canTrack } = await import("../../src/lib/consent");
    saveChoices({ advertising: "granted" });
    expect(await canTrack("advertising")).toBe(true);
    saveChoices({ advertising: "denied" });
    expect(await canTrack("advertising")).toBe(false);
  });
  it("GPC overrides acceptance and suppresses the notice", async () => {
    country("DE");
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    const { saveChoices, canTrack, needsAnswer } = await import("../../src/lib/consent");
    saveChoices({ advertising: "granted" });
    expect(await canTrack("advertising")).toBe(false);
    expect(await needsAnswer(["advertising"])).toBe(false);
  });
});