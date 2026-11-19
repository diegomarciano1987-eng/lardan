/**
 * 0346–0349 (Diego, 19/11/2026) — pendências da Etapa 1: referência junto da peça e código junto da consultora
 * nas comissões de indicação, Central de vendas e telas de nota fiscal. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const dia = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

let master: Conta, madrinha: Conta, indicada: Conta;
let deposito = "", praca = "", remessa = "", ciclo = "", vA = "";

beforeAll(async () => {
  master = await criarConta({ nome: `rc-master-${marca}`, papeis: ["master"], comParty: true });
  madrinha = await criarConta({ nome: `rc-mad-${marca}`, papeis: ["consultora"], comParty: true });
  indicada = await criarConta({ nome: `rc-ind-${marca}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`rc-${marca}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça RC ${marca}`])).linhas[0]!.id;
  let n = 0;
  for (const c of [madrinha, indicada]) {
    await adm.unsafe(`update public.parties set code = $2 where id = $1`, [c.partyId, `RC${marca}${++n}`]);
    await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [c.partyId]);
    await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id=excluded.praca_id`, [c.partyId, praca]);
  }
  await adm.unsafe(`update public.consultant_profiles set sponsor_party_id = $2 where party_id = $1`, [indicada.partyId, madrinha.partyId]);
  vA = await criarVariante(`rc-a-${marca}`, 7490);
  await adm.unsafe(`update public.products set reference_code = $2 where id = (select product_id from public.product_variants where id = $1)`, [vA, `LRC${marca}`.slice(0, 20)]);
  await porEstoque(vA, deposito, 20);
  remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito, _data_acerto: dia(30) })).dados.id;
  const m = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: indicada.partyId });
  if (m.erro) throw new Error(m.erro);
  ciclo = m.dados.cycle_id;
  const r = await rpc(master, "kit_item_upsert", { _cycle: ciclo, _variant: vA, _qty: 3 });
  if (r.erro) throw new Error(r.erro);
});

describe("Comissão de indicação guarda a referência da peça", () => {
  test("ao encerrar a maleta da indicada, cada peça vendida sai com variant_id e referência", async () => {
    await adm.unsafe(`insert into public.referral_settings (id, ativo) values (1, true) on conflict (id) do update set ativo = true`);
    await adm.unsafe(`delete from public.referral_tiers`);
    await adm.unsafe(`insert into public.referral_tiers (min_indicadas, percentual, titulo) values (1, 5, 'Bronze')`);
    await adm.unsafe(`insert into public.kit_balances (cycle_id, variant_id, qty_allocated, qty_accepted, qty_sold) values ($1,$2,3,3,2)
                      on conflict (cycle_id, variant_id) do update set qty_accepted = 3, qty_sold = 2`, [ciclo, vA]);
    // dispara exatamente o gatilho oficial: muda o status do ciclo para encerrada
    await adm.unsafe(`alter table public.kit_cycles disable trigger user`);
    await adm.unsafe(`alter table public.kit_cycles enable trigger zz_indicacao_apurar`);
    try {
      await adm.unsafe(`update public.kit_cycles set status = 'encerrada' where id = $1`, [ciclo]);
    } finally {
      await adm.unsafe(`alter table public.kit_cycles enable trigger user`);
    }
    const c = await um<{ itens: { variant_id: string; referencia: string; produto: string; qtd: number }[] }>(
      `select itens from public.referral_commissions where cycle_id = $1`, [ciclo]);
    expect(c.itens).toHaveLength(1);
    expect(c.itens[0]!.variant_id).toBe(vA);
    expect(c.itens[0]!.referencia).toBe(`LRC${marca}`.slice(0, 20));
    expect(c.itens[0]!.qtd).toBe(2);
  });

  test("painel de indicação traz o código da madrinha e da indicada", async () => {
    const r = await rpc<{ rede: { party_id: string; consultora_codigo: string; madrinha_codigo: string | null }[];
      comissoes: { madrinha_codigo: string; indicada_codigo: string }[] }>(master, "indicacao_painel_admin", {});
    expect(r.erro).toBeNull();
    const linha = r.dados.rede.find((x) => x.party_id === indicada.partyId)!;
    expect(linha.consultora_codigo).toBe(`RC${marca}2`);
    expect(linha.madrinha_codigo).toBe(`RC${marca}1`);
    const com = r.dados.comissoes.find((x) => x.indicada_codigo === `RC${marca}2`)!;
    expect(com.madrinha_codigo).toBe(`RC${marca}1`);
  });
});

describe("Central de vendas e notas fiscais: código junto do nome", () => {
  test("Central de vendas responde com consultora_codigo nas últimas vendas", async () => {
    const r = await rpc<{ ultimas: Record<string, unknown>[] }>(master, "central_vendas", { _de: dia(-30), _ate: dia(0) });
    expect(r.erro).toBeNull();
    for (const u of r.dados.ultimas) expect("consultora_codigo" in u).toBe(true);
  });

  test("telas fiscais carregam sem erro com o novo texto da consultora", async () => {
    for (const [fn, args] of [["fiscal_trocas_lista", {}], ["fiscal_focus_envios_lista", { _limite: 5 }],
      ["fiscal_recusas_incertas_pendentes", {}], ["fiscal_producao_estado", {}]] as const) {
      const r = await rpc(master, fn, args);
      expect([fn, r.erro]).toEqual([fn, null]);
    }
    const t = await um<{ x: string | null }>(`select nullif(concat_ws(' ', '[Cód. ' || nullif(btrim($1), '') || ']', $2::text), '') x`, ["7510", "Isabela"]);
    expect(t.x).toBe("[Cód. 7510] Isabela");
  });
});
