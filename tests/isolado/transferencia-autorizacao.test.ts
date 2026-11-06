import { expect, test } from "bun:test";
import { adm, criarConta } from "./base";

test("exceção 924/925 exige Master autorizado, nome único ativo, CPF ausente e prazo de um dia", async () => {
  const master = await criarConta({ nome: `aut-transf-${Date.now()}`, papeis: ["master"], comParty: true });
  const rep = await criarConta({ nome: `rep-aut-${Date.now()}`, papeis: ["representante"], comParty: true });
  const rem = crypto.randomUUID();
  const check = async (legado = 924) => {
    const rows = await adm.begin(async (tx) => {
      await tx.unsafe("select set_config('lardan.test_uid',$1,true)", [master.uid]);
      return tx.unsafe("select public.legado_transferencia_identidade_autorizada($1,$2,$3) ok", [legado, rem, rep.partyId]);
    });
    return rows[0]?.ok;
  };
  await adm.unsafe("update parties set status='ativo',doc=null where id=$1", [rep.partyId]);
  expect(await check()).toBe(false);
  const rows = await adm.unsafe(`insert into audit_logs(actor_id,action,entity,entity_id,payload)
    select $1,'legado_transferencia_identidade_autorizada','remessas',$2,
    jsonb_build_object('legado',924,'representante_party_id',id,'nome',display_name,'expedir',false,'preservar_vinculos',true)
    from parties where id=$3 returning id`, [master.uid, rem, rep.partyId]);
  const id = rows[0]?.id;
  if (!id) throw new Error("Auditoria sintética não criada");
  expect(await check()).toBe(true);
  expect(await check(925)).toBe(false);
  expect(await check(926)).toBe(false);
  await adm.unsafe("update audit_logs set created_at=now()-interval '2 days' where id=$1", [id]);
  expect(await check()).toBe(false);
  await adm.unsafe("update audit_logs set created_at=now(),actor_id=$2 where id=$1", [id, rep.uid]);
  expect(await check()).toBe(false);
  await adm.unsafe("update audit_logs set actor_id=$2 where id=$1", [id, master.uid]);
  await adm.unsafe("update parties set status='inativo' where id=$1", [rep.partyId]);
  expect(await check()).toBe(false);
});