import { describe, expect, test } from "vitest";
import { deveRecarregarSessao, estadoPermissao, falhaPassageira } from "./sessao-regras";

describe("sessão estável — ninguém cai por oscilação", () => {
  test("volta para a aba com a mesma pessoa não recarrega nada", () => {
    expect(deveRecarregarSessao("SIGNED_IN", "u1", "u1")).toBe(false);
    expect(deveRecarregarSessao("TOKEN_REFRESHED", "u1", "u1")).toBe(false);
    expect(deveRecarregarSessao("INITIAL_SESSION", undefined, "u1")).toBe(false);
  });

  test("entrar, trocar de pessoa ou sair recarrega", () => {
    expect(deveRecarregarSessao("SIGNED_IN", null, "u1")).toBe(true);
    expect(deveRecarregarSessao("SIGNED_IN", "u1", "u2")).toBe(true);
    expect(deveRecarregarSessao("SIGNED_OUT", "u1", null)).toBe(true);
    expect(deveRecarregarSessao("USER_UPDATED", "u1", "u1")).toBe(true);
  });

  test("falha de internet ou servidor é passageira; sessão inexistente não é", () => {
    expect(falhaPassageira({ name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" })).toBe(true);
    expect(falhaPassageira({ name: "AuthApiError", status: 503, message: "x" })).toBe(true);
    expect(falhaPassageira({ name: "AuthApiError", status: 429, message: "x" })).toBe(true);
    expect(falhaPassageira({ name: "TypeError", message: "Failed to fetch" })).toBe(true);
    expect(falhaPassageira({ name: "AuthSessionMissingError", status: 400, message: "Auth session missing!" })).toBe(false);
    expect(falhaPassageira({ name: "AuthApiError", status: 403, message: "session_not_found" })).toBe(false);
    expect(falhaPassageira(null)).toBe(false);
  });

  test("permissões já lidas continuam valendo se a releitura falhar", () => {
    expect(estadoPermissao([{ data: ["montagem"], isError: true }, { data: true, isError: false }])).toBe("pronto");
    expect(estadoPermissao([{ data: undefined, isError: true }, { data: true, isError: false }])).toBe("instavel");
    expect(estadoPermissao([{ data: undefined, isError: false }])).toBe("carregando");
  });
});
