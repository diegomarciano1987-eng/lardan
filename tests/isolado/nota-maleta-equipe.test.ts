/**
 * 0250 — NF-e da maleta pela equipe de montagem (pedido do Diego, 06/11/2026).
 * Quem tem kit.manage emite a nota da maleta; configuração fiscal continua só Master.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { criarConta, rpc, type Conta } from "./base";

let master: Conta, montagem: Conta, financeiro: Conta, consultora: Conta;

beforeAll(async () => {
  master = await criarConta({ nome: "master-nfm", papeis: ["master"] });
  montagem = await criarConta({ nome: "montagem-nfm", papeis: ["montagem"] });
  financeiro = await criarConta({ nome: "fin-nfm", papeis: ["financeiro"] });
  consultora = await criarConta({ nome: "cons-nfm", papeis: ["consultora"] });
});

describe("quem emite a nota da maleta", () => {
  test("Master emite", async () => {
    expect((await rpc<boolean>(master, "fiscal_focus_pode_maleta")).dados).toBe(true);
  });
  test("equipe de montagem (kit.manage) emite", async () => {
    expect((await rpc<boolean>(montagem, "fiscal_focus_pode_maleta")).dados).toBe(true);
  });
  test("montagem continua sem mexer na configuração fiscal", async () => {
    expect((await rpc<boolean>(montagem, "fiscal_focus_pode", { _acao: "emitir" })).dados).toBe(false);
  });
  test("financeiro e consultora não emitem", async () => {
    expect((await rpc<boolean>(financeiro, "fiscal_focus_pode_maleta")).dados).toBe(false);
    expect((await rpc<boolean>(consultora, "fiscal_focus_pode_maleta")).dados).toBe(false);
  });
});
