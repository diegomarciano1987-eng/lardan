/** 0194/0195 — WhatsApp da vitrine vira contato adicional; o principal do cadastro não muda. */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let c: Conta;
beforeAll(async () => { c = await criarConta({ nome: `zap-${Date.now()}`, papeis: ["consultora"], comParty: true }); });

describe("WhatsApp da vitrine", () => {
  test("registra como contato adicional, não principal, uma vez só", async () => {
    const r1 = await rpc<{ situacao: string }>(c, "vitrine_whatsapp_registrar", { _numero: "(43) 99876-5432" });
    expect(r1.erro).toBeNull();
    expect(r1.dados.situacao).toBe("registrado");
    const r2 = await rpc<{ situacao: string }>(c, "vitrine_whatsapp_registrar", { _numero: "43998765432" });
    expect(r2.dados.situacao).toBe("ja_existe");
    const l = (await adm.unsafe(`select is_primary, value_norm from public.contact_points where party_id=$1`, [c.partyId])) as { is_primary: boolean; value_norm: string }[];
    expect(l.length).toBe(1);
    expect(l[0]!.is_primary).toBe(false);
    expect(l[0]!.value_norm).toBe("+5543998765432");
  });
  test("recusa número sem DDD", async () => {
    expect((await rpc(c, "vitrine_whatsapp_registrar", { _numero: "98765" })).erro).toContain("DDD");
  });
});
