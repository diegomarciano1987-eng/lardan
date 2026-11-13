/**
 * 0309 (Diego, 13/11/2026: "de hoje em diante só vale o Lardan") — banco ISOLADO, dados sintéticos.
 * Cliente já conferida volta sozinha para a rotina uma vez por dia (desfaz o que mudaram direto no Asaas);
 * o que mudou no Lardan passa na frente.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm } from "./base";

let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
async function servico<T = unknown>(sql: string, p: unknown[] = []): Promise<T> {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false), set_config('request.jwt.claims','',false)`);
    return ((await c.unsafe(`select (${sql}) as r`, p)) as { r: T }[])[0]!.r;
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}

describe("0309 · reconferência diária do cadastro no Asaas", () => {
  let acc = "", p1 = "", p2 = "", velha = "", nova = "", mudou = "";
  const pessoa = async (nome: string) => (await um<{ id: string }>(`insert into public.parties (kind, display_name, status) values ('pessoa',$1,'ativo') returning id`, [nome])).id;
  const cliente = async (party: string) =>
    (await um<{ id: string }>(`insert into public.asaas_customers (account_id, external_id, name, party_id, match_status) values ($1,$2,'X',$3,'vinculado') returning id`, [acc, `cus_${marca()}`, party])).id;
  const proximos = (party: string, limite: number) =>
    servico<{ customer_id: string; primeira: boolean }[]>(`public.asaas_cliente_espelho_proximos('w0309', $2::int, $1::uuid)`, [party, limite]);
  beforeAll(async () => {
    const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO 0309 ${marca()}`])).id;
    acc = (await um<{ id: string }>(`insert into public.asaas_accounts (label, environment, financial_account_id, is_active) values ($1,'sandbox',$2,true) returning id`, [`ISO 0309 ${marca()}`, fin])).id;
    p1 = await pessoa(`ISO 0309 duas contas ${marca()}`);
    p2 = await pessoa(`ISO 0309 conferida hoje ${marca()}`);
    velha = await cliente(p1);
    mudou = await cliente(p1);
    nova = await cliente(p2);
    await adm.unsafe(`update public.asaas_cliente_espelho set estado='igual', conferido_em = now() - interval '25 hours', pedido_em = now() - interval '30 days' where customer_id=$1`, [velha]);
    await adm.unsafe(`update public.asaas_cliente_espelho set estado='pendente', pedido_em = now() where customer_id=$1`, [mudou]);
    await adm.unsafe(`update public.asaas_cliente_espelho set estado='igual', conferido_em = now() - interval '2 hours' where customer_id=$1`, [nova]);
  });

  test("mudança no Lardan passa na frente; depois vem a conferida há mais de um dia; a conferida hoje não volta", async () => {
    const um1 = await proximos(p1, 1);
    expect(um1.map((x) => x.customer_id)).toEqual([mudou]);
    expect(um1[0]!.primeira).toBe(false);
    expect((await proximos(p1, 50)).map((x) => x.customer_id)).toEqual([velha]);
    expect(await proximos(p2, 50)).toEqual([]);
  });

  test("depois de gravar, só volta no dia seguinte", async () => {
    expect(await servico<string>(`public.asaas_cliente_espelho_registrar($1::uuid,'w0309','igual','[]'::jsonb)`, [velha])).toBe("igual");
    expect((await proximos(p1, 50)).map((x) => x.customer_id)).not.toContain(velha);
  });
});
