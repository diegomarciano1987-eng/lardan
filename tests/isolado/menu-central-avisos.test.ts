/**
 * 0165 — "Central de Avisos" fora do menu principal da base do sistema.
 *
 * A tela continua existindo e alcançável (Configurações > Central de Avisos, busca
 * Ctrl+K e rota direta); o que não pode voltar é o botão no menu inferior.
 * Teste de módulo puro: não usa banco.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ADMIN_MODULES,
  ADMIN_SUBMODULES,
  findModule,
  moduleAllowed,
} from "../../src/lib/admin-modules";

/** Os seis destinos que aparecem no menu inferior para um Master. */
const primariaDoMenu = (roles: ("master" | "diretoria" | "marketing")[]) =>
  ADMIN_MODULES.filter((m) => moduleAllowed(m, [], roles)).slice(0, 6).map((m) => m.slug);

describe("menu principal da base do sistema", () => {
  test("não lista a Central de Avisos entre os módulos do menu", () => {
    expect(ADMIN_MODULES.some((m) => m.slug === "avisos")).toBe(false);
    expect(ADMIN_MODULES.some((m) => m.path === "/admin/avisos")).toBe(false);
  });

  test("os seis destinos do dock de um Master não incluem avisos", () => {
    expect(primariaDoMenu(["master"])).not.toContain("avisos");
    expect(primariaDoMenu(["diretoria"])).not.toContain("avisos");
    expect(primariaDoMenu(["marketing"])).not.toContain("avisos");
  });

  test("a tela continua alcançável como módulo interno", () => {
    const avisos = ADMIN_SUBMODULES.find((m) => m.slug === "avisos");
    expect(avisos?.path).toBe("/admin/avisos");
    expect(avisos?.label).toBe("Central de Avisos");
    expect(avisos?.state).toBe("ativo");
    expect(findModule("avisos")?.path).toBe("/admin/avisos");
  });

  test("a rota da tela continua no projeto", () => {
    const arquivo = join(import.meta.dir, "..", "..", "src", "routes", "_authenticated", "admin", "avisos.tsx");
    expect(existsSync(arquivo)).toBe(true);
  });
});
