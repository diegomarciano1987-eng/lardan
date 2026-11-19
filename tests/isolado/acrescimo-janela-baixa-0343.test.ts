/**
 * 0343 (Diego, 19/11/2026) — Etapa 2. Banco ISOLADO, dados sintéticos.
 *  - acréscimo de peças funciona com estoque zerado no depósito (peças na rua), igual à expedição;
 *  - consultora só fecha a baixa a partir de 10 dias antes do acerto; sem data de acerto, bloqueada;
 *  - equipe com kit.manage desfaz uma baixa fechada sem querer (motivo, auditoria), título cancelado,
 *    vendas marcadas preservadas e a baixa verdadeira pode ser fechada depois.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, saldo, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const dia = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

let master: Conta, cons: Conta, consB: Conta;
let deposito = "", depVazio = "", praca = "", remessa = "", ciclo = "", cicloB = "", vA = "", vB = "", vZero = "";

async function maletaAceita(c: Conta, rem: string, itens: [string, number][]) {
  const m = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem, _consultora: c.partyId });
  if (m.erro) throw new Error(m.erro);
  const id = m.dados.cycle_id;
  for (const [v, q] of itens) { const r = await rpc(master, "kit_item_upsert", { _cycle: id, _variant: v, _qty: q }); if (r.erro) throw new Error(r.erro); }
  for (const f of ["kit_conferir", "kit_expedir"]) {
    const r = await rpc(master, f, f === "kit_conferir" ? { _cycle: id, _note: null } : { _cycle: id, _payload: { rota: "direta" } });
    if (r.erro) throw new Error(`${f}: ${r.erro}`);
  }
  const t = (await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 order by seq limit 1`, [id])).id;
  const t1 = await rpc(c, "kit_transfer_confirm", { _transfer: t, _payload: {} });
  if (t1.erro) throw new Error(t1.erro);
  const a = await rpc(c, "kit_aceitar", { _cycle: id, _idempotency_key: `jb-${id}`, _itens: itens.map(([v, q]) => ({ variant_id: v, qty_accepted: q, qty_divergent: 0 })) });
  if (a.erro) throw new Error(a.erro);
  return id;
}

const acertoEm = async (cycle: string, data: string | null) => {
  await adm.unsafe(`update public.kit_cycles set due_at = $2::date + time '03:00' where id = $1`, [cycle, data]);
  await adm.unsafe(`update public.kit_pre_baixas set prazo = $2::date where cycle_id = $1`, [cycle, data]);
};

beforeAll(async () => {
  master = await criarConta({ nome: `jb-master-${marca}`, papeis: ["master"], comParty: true });
  cons = await criarConta({ nome: `jb-cons-${marca}`, papeis: ["consultora"], comParty: true });
  consB = await criarConta({ nome: `jb-consB-${marca}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`jb-${marca}`);
  depVazio = await criarDeposito(`jb-vazio-${marca}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça JB ${marca}`])).linhas[0]!.id;
  for (const c of [cons, consB]) {
    await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [c.partyId]);
    await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id=excluded.praca_id`, [c.partyId, praca]);
  }
  vA = await criarVariante(`jb-a-${marca}`, 10000);
  vB = await criarVariante(`jb-b-${marca}`, 5000);
  vZero = await criarVariante(`jb-z-${marca}`, 4990);
  for (const v of [vA, vB]) await porEstoque(v, deposito, 50);
  const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`JB ${marca}`])).id;
  const emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`JB Emp ${marca}`])).id;
  await adm.unsafe(`delete from public.consultora_cobranca_config`);
  await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`, [master.uid, emp, fin]);
  await adm.unsafe(`delete from public.consultora_comissao_faixas`);
  await adm.unsafe(`insert into public.consultora_comissao_faixas (min_vendido_cents, percentual, titulo) values (0,20,'20%'),(50000,30,'30%')`);
  // acerto daqui a 40 dias: igual às remessas de janeiro do Daniel
  remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito, _data_acerto: dia(40) })).dados.id;
  ciclo = await maletaAceita(cons, remessa, [[vA, 3], [vB, 2]]);
  cicloB = await maletaAceita(consB, remessa, [[vA, 2]]);
});

describe("Acréscimo com estoque ainda não contado", () => {
  test("depósito com 0 da peça não barra o acréscimo; saldo fica negativo e a saída acima do disponível é auditada", async () => {
    expect(await saldo(vZero, depVazio)).toBe(0);
    const r = await rpc<{ movement_id: string; quantidade: number }>(master, "kit_acrescimo", {
      _cycle: ciclo, _payload: { origem_location_id: depVazio, itens: [{ variant_id: vZero, quantity: 2 }], idempotency_key: `jb-acr-${marca}` } });
    expect(r.erro).toBeNull();
    expect(r.dados.quantidade).toBe(2);
    expect(await saldo(vZero, depVazio)).toBe(-2);
    const mov = await um<{ status: string; n: number }>(`select m.status, (select sum(quantity) from public.kit_movement_items i where i.movement_id=m.id)::int n from public.kit_movements m where m.id=$1`, [r.dados.movement_id]);
    expect(mov).toEqual({ status: "pendente", n: 2 });
    const aud = await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='stock.transfer.acima_do_disponivel' and entity_id=$1`, [vZero]);
    expect(aud.n).toBeGreaterThan(0);
  });

  test("a consultora confirma o recebimento e a peça extra entra no saldo da maleta", async () => {
    const m = await um<{ id: string }>(`select id from public.kit_movements where cycle_id=$1 and kind='acrescimo' order by created_at desc limit 1`, [ciclo]);
    expect((await rpc(cons, "kit_acrescimo_confirmar", { _movement: m.id, _payload: {} })).erro).toBeNull();
    const b = await um<{ qty_accepted: number }>(`select qty_accepted from public.kit_balances where cycle_id=$1 and variant_id=$2`, [ciclo, vZero]);
    expect(b.qty_accepted).toBe(2);
  });
});

describe("Baixa só 10 dias antes do acerto", () => {
  test("acerto daqui a 40 dias: a consultora marca vendas, mas não fecha", async () => {
    expect((await rpc(cons, "pre_baixa_abrir", { _cycle: ciclo })).erro).toBeNull();
    expect((await rpc(cons, "pre_baixa_vender", { _cycle: ciclo, _variant: vA, _qtd: 2 })).erro).toBeNull();
    const f = await rpc(cons, "pre_baixa_fechar", { _cycle: ciclo });
    expect(f.erro).toContain("só fica liberada a partir de");
    const st = await um<{ status: string; t: number }>(`select status, (select count(*)::int from public.financial_titles where id_externo like 'prebaixa:'||p.id||'%') t from public.kit_pre_baixas p where cycle_id=$1`, [ciclo]);
    expect(st).toEqual({ status: "aberta", t: 0 });
  });

  test("o app recebe a data em que a baixa libera (acerto − 10 dias)", async () => {
    const l = await rpc<{ janela: { acerto_em: string; libera_em: string; liberada: boolean }; janela_vale: boolean }>(cons, "pre_baixa_ler", { _cycle: ciclo });
    expect(l.dados.janela_vale).toBe(true);
    expect(l.dados.janela.acerto_em).toBe(dia(40));
    expect(l.dados.janela.libera_em).toBe(dia(30));
    expect(l.dados.janela.liberada).toBe(false);
    // para a equipe a regra não vale
    expect((await rpc<{ janela_vale: boolean }>(master, "pre_baixa_ler", { _cycle: ciclo })).dados.janela_vale).toBe(false);
  });

  test("sem data de acerto: bloqueada", async () => {
    await adm.unsafe(`update public.remessas set data_acerto = null where id=$1`, [remessa]);
    await acertoEm(ciclo, null);
    const f = await rpc(cons, "pre_baixa_fechar", { _cycle: ciclo });
    expect(f.erro).toContain("ainda não foi definida");
    await adm.unsafe(`update public.remessas set data_acerto = $2 where id=$1`, [remessa, dia(40)]);
  });

  test("11 dias antes ainda bloqueia; 10 dias antes libera e gera o título", async () => {
    await acertoEm(ciclo, dia(11));
    expect((await rpc(cons, "pre_baixa_fechar", { _cycle: ciclo })).erro).toContain("só fica liberada");
    await acertoEm(ciclo, dia(10));
    const f = await rpc<{ installment_id: string; valor_pagar_cents: number }>(cons, "pre_baixa_fechar", { _cycle: ciclo });
    expect(f.erro).toBeNull();
    // 2 × 100,00 = 200,00 → 20% → paga 160,00
    expect(f.dados.valor_pagar_cents).toBe(16000);
  });

  test("a equipe (kit.manage) fecha fora da janela", async () => {
    expect((await rpc(master, "pre_baixa_vender", { _cycle: cicloB, _variant: vA, _qtd: 1 })).erro).toBeNull();
    expect((await rpc(master, "pre_baixa_fechar", { _cycle: cicloB })).erro).toBeNull();
  });
});

describe("Desfazer baixa fechada sem querer", () => {
  test("consultora não desfaz; motivo é obrigatório", async () => {
    expect((await rpc(cons, "pre_baixa_desfazer", { _cycle: ciclo, _motivo: "testando o app" })).ok).toBe(false);
    expect((await rpc(master, "pre_baixa_desfazer", { _cycle: ciclo, _motivo: "x" })).erro).toContain("motivo");
  });

  test("a equipe desfaz: volta a 'lançando vendas', título cancelado, vendas preservadas, auditado", async () => {
    const antes = await um<{ title_id: string }>(`select title_id from public.kit_pre_baixas where cycle_id=$1`, [ciclo]);
    const r = await rpc<{ titulo_cancelado: string; repetida: boolean }>(master, "pre_baixa_desfazer", { _cycle: ciclo, _motivo: "Consultora clicou sem querer" });
    expect(r.erro).toBeNull();
    expect(r.dados.titulo_cancelado).toBe(antes.title_id);
    const p = await um<{ status: string; title_id: string | null; fechada_em: string | null }>(`select status, title_id, fechada_em from public.kit_pre_baixas where cycle_id=$1`, [ciclo]);
    expect(p).toEqual({ status: "aberta", title_id: null, fechada_em: null });
    const t = await um<{ status: string; id_externo: string }>(`select status::text, id_externo from public.financial_titles where id=$1`, [antes.title_id]);
    expect(t.status).toBe("cancelado");
    expect(t.id_externo).toContain(":desfeita:");
    const vend = await um<{ qtd_vendida: number }>(`select i.qtd_vendida from public.kit_pre_baixa_itens i join public.kit_pre_baixas p on p.id=i.pre_baixa_id where p.cycle_id=$1 and i.variant_id=$2`, [ciclo, vA]);
    expect(vend.qtd_vendida).toBe(2);
    const ev = await um<{ n: number }>(`select count(*)::int n from public.kit_events where cycle_id=$1 and kind='pre_baixa.desfeita'`, [ciclo]);
    expect(ev.n).toBe(1);
    const aud = await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='pre_baixa.desfeita' and payload->>'cycle_id'=$1`, [ciclo]);
    expect(aud.n).toBe(1);
    // clicar de novo não faz nada
    expect((await rpc<{ repetida: boolean }>(master, "pre_baixa_desfazer", { _cycle: ciclo, _motivo: "Consultora clicou sem querer" })).dados.repetida).toBe(true);
  });

  test("na hora certa a consultora fecha de novo, com título novo", async () => {
    const f = await rpc<{ installment_id: string; valor_pagar_cents: number }>(cons, "pre_baixa_fechar", { _cycle: ciclo });
    expect(f.erro).toBeNull();
    expect(f.dados.valor_pagar_cents).toBe(16000);
    const n = await um<{ n: number }>(`select count(*)::int n from public.financial_titles t join public.kit_pre_baixas p on t.id_externo like 'prebaixa:'||p.id||'%' where p.cycle_id=$1 and t.status='ativo'`, [ciclo]);
    expect(n.n).toBe(1);
  });

  test("depois da conferência não desfaz", async () => {
    await adm.unsafe(`update public.kit_pre_baixas set conferida_em = now() where cycle_id=$1`, [ciclo]);
    expect((await rpc(master, "pre_baixa_desfazer", { _cycle: ciclo, _motivo: "Consultora clicou sem querer" })).erro).toContain("ainda não foi conferida");
  });
});

describe("0345 — data de acerto obrigatória na remessa", () => {
  test("abrir remessa sem data de acerto é recusado; editar apagando a data também", async () => {
    const r = await rpc(master, "remessa_criar", { _praca: praca, _deposito: deposito });
    expect(r.erro).toContain("data de acerto");
    const e = await rpc(master, "remessa_atualizar", { _id: remessa, _data_acerto: null, _representante: null, _status: null, _observacoes: null });
    expect(e.erro).toContain("data de acerto");
    const d = await um<{ data_acerto: string }>(`select data_acerto::text from public.remessas where id=$1`, [remessa]);
    expect(d.data_acerto).not.toBeNull();
  });
});
