import { beforeEach, expect, test, vi } from "vitest";

const estado = vi.hoisted(() => ({ resposta: "", chamadas: [] as unknown[] }));
vi.mock("@lovable.dev/ai-gateway", () => ({
  generateResponse: async (payload: unknown) => {
    estado.chamadas.push(payload);
    return { output: [{ type: "message", content: [{ type: "output_text", text: estado.resposta }] }] };
  },
}));

import { lerComIa } from "./ia.server";

beforeEach(() => {
  estado.chamadas.length = 0;
  estado.resposta = "";
});

test("IA devolve somente a classificação validada", async () => {
  estado.resposta = JSON.stringify({ intencao: "sim", duvida: false, robo: false, humano: false, sair: false, revisao: false, como_conheceu: "instagram" });
  await expect(lerComIa("Quero participar", "mensagem 1")).resolves.toMatchObject({ intencao: "sim", comoConheceu: "instagram", duvida: false });
  expect(estado.chamadas).toHaveLength(1);
  expect(JSON.stringify(estado.chamadas[0])).toContain('"json_schema"');
});

test("resposta fora do contrato faz a conversa seguir para uma pessoa", async () => {
  estado.resposta = "não é JSON";
  await expect(lerComIa("mensagem ambígua", "mensagem 1")).resolves.toBeNull();
});

test("mensagem vazia não chama a IA", async () => {
  await expect(lerComIa("  ", "mensagem 1")).resolves.toBeNull();
  expect(estado.chamadas).toHaveLength(0);
});
