import { describe, expect, test } from "bun:test";
import { adm, criarConta, rpc } from "./base";

describe("Pix do pedido — permissões e auditoria", () => {
  test("consulta é exclusiva da operação de maletas", async () => {
    const c = await criarConta({ nome: "pix-read-consultora", papeis: ["consultora"], comParty: true });
    expect((await rpc(c, "pedido_pix_asaas_ler")).ok).toBe(false);
  });
  test("nem Master grava Pix diretamente; escrita somente pelo executor", async () => {
    const c = await criarConta({ nome: "pix-write-master", papeis: ["master"], comParty: true });
    const res = await rpc(c, "pedido_pix_asaas_gravar", { _actor: c.id, _account: crypto.randomUUID(), _qr: "teste", _chave: "teste", _payload: "000201teste" });
    expect(res.ok).toBe(false);
    const p = await adm.unsafe(`select has_function_privilege('authenticated','public.pedido_pix_asaas_gravar(uuid,uuid,text,text,text)','execute') a, has_function_privilege('service_role','public.pedido_pix_asaas_gravar(uuid,uuid,text,text,text)','execute') s`);
    expect(p[0]?.a).toBe(false); expect(p[0]?.s).toBe(true);
  });
});