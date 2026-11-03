/**
 * 0201 — Cockpit da consultora: os números batem entre as telas. Banco ISOLADO, dados sintéticos.
 *  C1. venda do SmallData no app = regra do BI (só a cobrança vale quando a importação de cobrança existe);
 *  C2. depois da conferência, vendido − comissão − recebido = valor do acerto (comissão final);
 *  C3. "Meu histórico" e montagem acham o SmallData pelos mesmos códigos do resto do sistema.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 600000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, cons: Conta, deposito = "", praca = "", vA = "";
let cobrancaAntes: Record<string, unknown>[] = [];
let faixasAntes: Record<string, unknown>[] = [];

beforeAll(async () => {
  master = await criarConta({ nome: `ck-master-${marca}`, papeis: ["master"], comParty: true });
  cons = await criarConta({ nome: `ck-cons-${marca}`, papeis: ["consultora"], comParty: true });
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [cons.partyId]);
  // código SmallData só em party_codigos_legados (código adotado), não em legado_consultoras.party_id
  await adm.unsafe(`insert into public.party_codigos_legados (party_id, sistema, codigo) values ($1,'cliente',$2)`, [cons.partyId, String(base)]);
  await adm.unsafe(`insert into public.legado_consultoras (codcli, nome) values ($1,'CK Antiga') on conflict (codcli) do nothing`, [base]);
  // R1: cobrança (vale) · R2: fechamento antigo sem cobrança (vale zero no BI e no SmallData)
  await adm.unsafe(`insert into public.legado_acertos_consultora (remessa, codcli, valor_cents, data, tipo, fonte) values ($1,$2,50000,'2026-08-10','remessa','cobranca')`, [base * 10 + 1, base]);
  await adm.unsafe(`insert into public.legado_acertos_consultora (remessa, codcli, valor_cents, data, tipo, fonte) values ($1,$2,30000,'2026-09-10','remessa','remessa_cliente')`, [base * 10 + 2, base]);

  deposito = await criarDeposito(`ck-${marca}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça CK ${marca}`])).linhas[0]!.id;
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id=excluded.praca_id`, [cons.partyId, praca]);
  await adm.unsafe(`update public.parties set status='ativo' where id=$1`, [cons.partyId]);
  vA = await criarVariante(`ck-a-${marca}`, 10000);
  await porEstoque(vA, deposito, 20);
  const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`CK ${marca}`])).id;
  const emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`CK Emp ${marca}`])).id;
  cobrancaAntes = (await adm.unsafe(`select * from public.consultora_cobranca_config`)) as Record<string, unknown>[];
  faixasAntes = (await adm.unsafe(`select min_vendido_cents, percentual, titulo from public.consultora_comissao_faixas`)) as Record<string, unknown>[];
  await adm.unsafe(`delete from public.consultora_cobranca_config where true`);
  await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`, [master.uid, emp, fin]);
  await adm.unsafe(`delete from public.consultora_comissao_faixas where true`);
  await adm.unsafe(`insert into public.consultora_comissao_faixas (min_vendido_cents, percentual, titulo) values (0,20,'20%'),(20000,25,'25%'),(50000,30,'30%'),(65000,35,'35%'),(120000,40,'40%')`);
});

afterAll(async () => {
  await adm.unsafe(`delete from public.legado_acertos_consultora where codcli = $1`, [base]);
  await adm.unsafe(`delete from public.consultora_cobranca_config where true`);
  for (const c of cobrancaAntes) {
    await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`,
      [c["ator_user_id"], c["business_entity_id"], c["financial_account_id"]]);
  }
  await adm.unsafe(`delete from public.consultora_comissao_faixas where true`);
  for (const f of faixasAntes) {
    await adm.unsafe(`insert into public.consultora_comissao_faixas (min_vendido_cents, percentual, titulo) values ($1,$2,$3)`, [f["min_vendido_cents"], f["percentual"], f["titulo"]]);
  }
});

describe("cockpit da consultora", () => {
  test("C1: fechamento antigo sem cobrança não entra na venda do app (igual ao BI)", async () => {
    const r = (await adm.unsafe(`select origem, remessa, vendido_cents::text v from public.consultora_acertos_vendas($1)`, [cons.partyId])) as { remessa: number; v: string }[];
    expect(r.map((x) => [x.remessa, x.v])).toEqual([[base * 10 + 1, "50000"]]);
    const h = await rpc<{ resumo: { vendido_cents: number } }>(cons, "consultora_historico_vendas");
    expect(h.erro).toBeNull();
    expect(Number(h.dados.resumo.vendido_cents)).toBe(50000);
  });

  test("C3: 'Meu histórico' reconhece o código SmallData adotado", async () => {
    const m = await rpc<{ vinculada: boolean }>(cons, "consultora_meu_historico");
    expect(m.erro).toBeNull();
    expect(m.dados.vinculada).toBe(true);
  });

  test("C2: depois da conferência, vendido − comissão − recebido = valor do acerto, no app e no cockpit da equipe", async () => {
    const rem = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito,
      _data_acerto: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) })).dados.id;
    const ciclo = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem, _consultora: cons.partyId })).dados.cycle_id;
    await rpc(master, "kit_item_upsert", { _cycle: ciclo, _variant: vA, _qty: 3 });
    await rpc(master, "kit_conferir", { _cycle: ciclo, _note: null });
    await rpc(master, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } });
    const t = (await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 order by seq limit 1`, [ciclo])).id;
    await rpc(cons, "kit_transfer_confirm", { _transfer: t, _payload: {} });
    expect((await rpc(cons, "kit_aceitar", { _cycle: ciclo, _idempotency_key: `ck-${ciclo}`, _itens: [{ variant_id: vA, qty_accepted: 3, qty_divergent: 0 }] })).erro).toBeNull();
    await rpc(cons, "pre_baixa_vender", { _cycle: ciclo, _variant: vA, _qtd: 1 });           // declarou 1 (100,00 → 20%)
    expect((await rpc(cons, "pre_baixa_fechar", { _cycle: ciclo })).erro).toBeNull();
    // voltou só 1: 2 vendidas de fato (200,00 → 25% = 50,00 → acerto 150,00)
    const c = await rpc<{ comissao_cents: number; valor_final_cents: number }>(master, "pre_baixa_conferir", { _cycle: ciclo, _leituras: [{ variant_id: vA, qtd: 1 }], _aplicar: true });
    expect(c.erro).toBeNull();
    expect(c.dados).toMatchObject({ comissao_cents: 5000, valor_final_cents: 15000 });

    const f = await rpc<{ acertos: { origem: string; vendido_cents: number; comissao_cents: number; pagar_cents: number }[] }>(cons, "consultora_meu_financeiro");
    const a = f.dados.acertos.find((x) => x.origem === "lardan")!;
    expect([Number(a.vendido_cents), Number(a.comissao_cents), Number(a.pagar_cents)]).toEqual([20000, 5000, 15000]);

    const l = (await adm.unsafe(`select vendido_cents::text v, comissao_cents::text c from public.consultora_acertos_vendas($1) where origem='lardan'`, [cons.partyId])) as { v: string; c: string }[];
    expect(l).toEqual([{ v: "20000", c: "5000" }]);

    const nf = await rpc<unknown>(master, "consultora_notas_e_fechamentos", { _party: cons.partyId });
    expect(nf.erro).toBeNull();
    expect(JSON.stringify(nf.dados).replace(/\s/g, "")).toContain('"comissao_cents":5000');
  });
});
