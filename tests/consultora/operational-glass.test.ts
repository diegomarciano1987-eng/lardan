import { describe, expect, it } from "vitest";
import { isOperationalGlassPath } from "../../src/lib/operational-glass";

describe("glass restricted to the operational system", () => {
  it("includes all admin modules and nested financial screens", () => {
    for (const path of ["/admin", "/admin/financeiro", "/admin/financeiro/dfc", "/admin/cadastros/produtos", "/admin/pdv"]) {
      expect(isOperationalGlassPath(path)).toBe(true);
    }
  });
  it("includes representative and store terminals", () => {
    for (const path of ["/representante", "/pdv", "/loja"]) expect(isOperationalGlassPath(path)).toBe(true);
  });
  it("never themes public pages, vitrines or similar path prefixes", () => {
    for (const path of ["/", "/seja-lardan", "/semijoias", "/semijoias/brincos", "/guia/semijoia-folheado-ou-bijuteria", "/v/diego", "/contato", "/a-lardan", "/administracao", "/representantes", "/pdv-publico", "/acesso", "/consultora"]) {
      expect(isOperationalGlassPath(path)).toBe(false);
    }
  });
});