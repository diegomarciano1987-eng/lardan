import { describe, expect, test } from "bun:test";
import { adm, criarConta, rpc } from "./base";

describe("Pix do pedido — permissões e auditoria", () => {
  test("consulta é exclusiva da operação de maletas", async () => {
    const c = await criarConta({ nome: "pix-read-consultora", papeis: ["consultora"], comParty: true });
    expect((await rpc(c, "pedido_pix_asaas_ler")).ok).toBe(false);
  });
  test("nem Master grava Pix diretamente; escrita somente pelo executor", async () => {
    const c = await criarConta({ nome: "pix-write-master", papeis: ["master"], comParty: true });
    const res = await rpc(c, "pedido_pix_asaas_gravar", { _actor: c.uid, _account: crypto.randomUUID(), _qr: "teste", _chave: "teste", _payload: "000201teste" });
    expect(res.ok).toBe(false);
    const p = await adm.unsafe(`select has_function_privilege('authenticated','public.pedido_pix_asaas_gravar(uuid,uuid,text,text,text)','execute') a, has_function_privilege('service_role','public.pedido_pix_asaas_gravar(uuid,uuid,text,text,text)','execute') s`);
    expect(p[0]?.a).toBe(false); expect(p[0]?.s).toBe(true);
  });
  test("executor rejeita ator não Master e registra auditoria no vínculo", async () => {
    const cons = await criarConta({ nome: "pix-audit-consultora", papeis: ["consultora"], comParty: true });
    const master = await criarConta({ nome: "pix-audit-master", papeis: ["master"], comParty: true });
    const conta = crypto.randomUUID();
    await expect(adm.unsafe(`select public.pedido_pix_asaas_gravar($1,$2,'qr-iso','chave-iso','000201iso')`, [cons.uid, conta])).rejects.toThrow("Só o Master");
    await adm.unsafe(`select public.pedido_pix_asaas_gravar($1,$2,'qr-iso','chave-iso','000201iso')`, [master.uid, conta]);
    const rows = await adm.unsafe(`select actor_id,payload->>'qr_id' qr from public.audit_logs where action='pedido.pix_asaas_atualizado' and actor_id=$1`, [master.uid]);
    expect(rows).toHaveLength(1); expect(rows[0]?.qr).toBe("qr-iso");
  });
});