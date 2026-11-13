/**
 * 0315 (Diego, 13/11/2026) — lugar para desfazer movimento errado de maleta (equipe e representante),
 * contato de recado/referência, referência da peça na maleta e banho por categoria nas vendas.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 700000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, colab: Conta, rep: Conta, repOutro: Conta, ana: Conta, bia: Conta, carla: Conta, joice: Conta, dora: Conta, eva: Conta, gil: Conta, hel: Conta;
let deposito = "", vA = "", praca = "", remessa = "";
let mAna = "", mCarla = "", mDora = "", mGil = "";

async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}
async function montarConferida(c: Conta) {
  const id = (await ok<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: c.partyId })).cycle_id;
  await ok(master, "kit_item_upsert", { _cycle: id, _variant: vA, _qty: 2 });
  await ok(master, "kit_conferir", { _cycle: id, _note: null });
  return id;
}
const transitoPara = async (cycle: string, para: string) =>
  um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 and status='transito' and to_party_id=$2 order by seq desc limit 1`, [cycle, para]);
const ciclo = (id: string) => um<{ consultora_party_id: string | null; status: string; custodian_party_id: string | null }>(
  `select consultora_party_id, status::text, custodian_party_id from public.kit_cycles where id=$1`, [id]);
const ultimoMov = (id: string) => um<{ id: string }>(
  `select id from public.kit_events where cycle_id=$1 and kind = any(public.maleta_movimento_kinds()) order by created_at desc, (kind='maleta.trocada_para_abertura') desc limit 1`, [id]);
const entregarEAceitar = async (m: string, c: Conta) => {
  await ok(rep, "kit_transfer_forward", { _cycle: m, _payload: { note: "Entregue em mãos" } });
  await ok(c, "kit_transfer_confirm", { _transfer: (await transitoPara(m, c.partyId!)).id, _payload: {} });
  await ok(c, "kit_aceitar", { _cycle: m, _itens: [{ variant_id: vA, qty_accepted: 2, qty_divergent: 0 }], _idempotency_key: `d315-${m}` });
};

beforeAll(async () => {
  master = await criarConta({ nome: `d315-master-${base}`, papeis: ["master"], comParty: true });
  colab = await criarConta({ nome: `d315-equipe-${base}`, papeis: ["montagem"], comParty: true });
  rep = await criarConta({ nome: `d315-rep-${base}`, papeis: ["representante"], comParty: true });
  repOutro = await criarConta({ nome: `d315-rep2-${base}`, papeis: ["representante"], comParty: true });
  [ana, bia, carla, joice, dora, eva, gil, hel] = await Promise.all(["ana", "bia", "carla", "joice", "dora", "eva", "gil", "hel"].map((n) =>
    criarConta({ nome: `d315-${n}-${base}`, papeis: ["consultora"], comParty: true })));
  deposito = await criarDeposito(`d315-${marca}`);
  vA = await criarVariante(`d315-a-${marca}`, 10000);
  await adm.unsafe(`update public.product_variants set reference_code=$2 where id=$1`, [vA, `LBR-D315-${base}`]);
  await porEstoque(vA, deposito, 80);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`D315 ${marca}`])).linhas[0]!.id;
  for (const c of [ana, bia, carla, joice, dora, eva, gil, hel]) {
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                      on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`,
      [c.partyId, rep.partyId, praca]);
  }
  remessa = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) })).id;
  mAna = await montarConferida(ana);
  mCarla = await montarConferida(carla);
  mDora = await montarConferida(dora);
  mGil = await montarConferida(gil);
  await ok(master, "remessa_expedir_representante", { _remessa: remessa });
  for (const m of [mAna, mCarla, mDora, mGil]) {
    await ok(rep, "kit_transfer_confirm", { _transfer: (await transitoPara(m, rep.partyId!)).id, _payload: {} });
  }
});

describe("desfazer movimento errado — equipe", () => {
  test("troca errada Ana → Bia: aparece na lista, prévia explica e o desfazer devolve para a Ana", async () => {
    await ok(master, "remessa_maleta_transferir", { _cycle: mAna, _consultora: bia.partyId, _motivo: "troca errada de teste" });
    expect((await ciclo(mAna)).consultora_party_id).toBe(bia.partyId!);
    const lista = await ok<{ evento_id: string; maleta: string; para: string; ultimo: boolean }[]>(master, "maleta_movimentos_lista", { _busca: `d315-bia-${base}` });
    const mov = lista.find((x) => x.ultimo)!;
    expect(mov.para).toBe(`ISO d315-bia-${base}`);
    const p = await ok<{ pode: boolean; para_party_id: string }>(master, "maleta_movimento_previa", { _evento: mov.evento_id });
    expect(p).toMatchObject({ pode: true, para_party_id: ana.partyId! });
    const curto = await rpc(master, "maleta_movimento_desfazer", { _evento: mov.evento_id, _motivo: "errei" });
    expect(curto.erro).toContain("mínimo 10");
    await ok(master, "maleta_movimento_desfazer", { _evento: mov.evento_id, _motivo: "Bia não era a destinatária, volta para a Ana" });
    expect(await ciclo(mAna)).toMatchObject({ consultora_party_id: ana.partyId!, status: "transito", custodian_party_id: rep.partyId! });
    const reg = await um<{ n: number }>(`select count(*)::int n from public.maleta_movimentos_desfeitos where evento_id=$1 and motivo like 'Bia não era%'`, [mov.evento_id]);
    expect(reg.n).toBe(1);
    const aud = await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='maleta.movimento_desfeito' and entity_id=$1`, [mAna]);
    expect(aud.n).toBe(1);
  });

  test("o mesmo movimento não pode ser desfeito duas vezes", async () => {
    const ev = await um<{ id: string }>(`select evento_id id from public.maleta_movimentos_desfeitos where cycle_id=$1`, [mAna]);
    const r = await rpc(master, "maleta_movimento_desfazer", { _evento: ev.id, _motivo: "tentando desfazer de novo" });
    expect(r.erro).not.toBeNull();
  });

  test("consultora sem permissão de maletas não desfaz nem vê a lista", async () => {
    await ok(master, "remessa_maleta_transferir", { _cycle: mGil, _consultora: hel.partyId, _motivo: "outra troca de teste" });
    const ev = await ultimoMov(mGil);
    expect((await rpc(hel, "maleta_movimento_desfazer", { _evento: ev.id, _motivo: "consultora tentando desfazer" })).erro).not.toBeNull();
    expect((await rpc(hel, "maleta_movimentos_lista", {})).erro).not.toBeNull();
  });
});

describe("desfazer movimento errado — representante", () => {
  test("representante desfaz a troca que ele mesmo fez no app", async () => {
    await ok(rep, "rep_maleta_trocar_destino", { _rep: rep.partyId, _cycle: mCarla, _consultora: joice.partyId });
    expect((await ciclo(mCarla)).consultora_party_id).toBe(joice.partyId!);
    const ev = await ultimoMov(mCarla);
    expect((await rpc(repOutro, "maleta_movimento_desfazer", { _evento: ev.id, _motivo: "outro representante tentando", _rep: repOutro.partyId })).erro).not.toBeNull();
    const lista = await ok<{ evento_id: string }[]>(rep, "maleta_movimentos_lista", { _rep: rep.partyId });
    expect(lista.map((x) => x.evento_id)).toContain(ev.id);
    await ok(rep, "maleta_movimento_desfazer", { _evento: ev.id, _motivo: "passei para a Joice por engano", _rep: rep.partyId });
    expect((await ciclo(mCarla)).consultora_party_id).toBe(carla.partyId!);
  });

  test("depois que a consultora errada aceitou, o representante não desfaz; só o Master", async () => {
    await ok(master, "remessa_maleta_transferir", { _cycle: mDora, _consultora: eva.partyId, _motivo: "troca errada para a Eva" });
    await entregarEAceitar(mDora, eva);
    expect((await ciclo(mDora)).status).toBe("operacao");
    const ev = await ultimoMov(mDora);
    const r = await rpc(rep, "maleta_movimento_desfazer", { _evento: ev.id, _motivo: "representante quer desfazer", _rep: rep.partyId });
    expect(r.erro).toContain("só o Master");
    const p = await ok<{ pode: boolean; aceita: boolean }>(master, "maleta_movimento_previa", { _evento: ev.id });
    expect(p).toMatchObject({ pode: true, aceita: true });
  });

  test("com peça vendida o Master também não desfaz (o caminho é o acerto)", async () => {
    const ev = await ultimoMov(mDora);
    await adm.unsafe(`update public.kit_balances set qty_sold=1 where cycle_id=$1`, [mDora]);
    const p = await ok<{ pode: boolean; bloqueio: string }>(master, "maleta_movimento_previa", { _evento: ev.id });
    expect(p.pode).toBe(false);
    expect(p.bloqueio).toContain("vendida");
    await adm.unsafe(`update public.kit_balances set qty_sold=0 where cycle_id=$1`, [mDora]);
  });

  test("Master desfaz depois do aceite sem venda: aceite guardado em cópia, maleta volta ao representante para a Dora", async () => {
    const ev = await ultimoMov(mDora);
    await ok(master, "maleta_movimento_desfazer", { _evento: ev.id, _motivo: "Eva aceitou maleta que era da Dora" });
    expect(await ciclo(mDora)).toMatchObject({ consultora_party_id: dora.partyId!, status: "transito", custodian_party_id: rep.partyId! });
    const ac = await um<{ n: number }>(`select count(*)::int n from public.kit_acceptances where cycle_id=$1`, [mDora]);
    expect(ac.n).toBe(0);
    const copia = await um<{ aceite: boolean; n: number }>(
      `select aceite_desfeito aceite, jsonb_array_length(copia->'aceites')::int n from public.maleta_movimentos_desfeitos where evento_id=$1`, [ev.id]);
    expect(copia).toEqual({ aceite: true, n: 1 });
    const saldo = await um<{ aceito: number }>(`select sum(qty_accepted)::int aceito from public.kit_balances where cycle_id=$1`, [mDora]);
    expect(saldo.aceito).toBe(0);
    // a Dora recebe e aceita normalmente de novo
    await entregarEAceitar(mDora, dora);
    expect((await ciclo(mDora)).status).toBe("operacao");
  });
});

describe("referência da peça na maleta", () => {
  test("a composição traz a referência da etiqueta junto do nome", async () => {
    const d = await ok<{ composicao: { referencia: string | null }[] }>(master, "kit_detail", { _cycle: mAna });
    expect(d.composicao[0]!.referencia).toBe(`LBR-D315-${base}`);
  });
});

describe("contato de recado e referência", () => {
  test("representante grava para a consultora dele; telefone sem DDD é recusado; outro representante não vê", async () => {
    const bad = await rpc(rep, "party_referencias_salvar", { _party: ana.partyId, _itens: [{ tipo: "recado", nome: "Maria", parentesco: "Mãe", telefone: "99999" }] });
    expect(bad.erro).toContain("DDD");
    await ok(rep, "party_referencias_salvar", { _party: ana.partyId, _itens: [
      { tipo: "recado", nome: "Maria", parentesco: "Mãe", telefone: "(43) 99999-1111" },
      { tipo: "referencia", nome: "José", parentesco: "Vizinho", telefone: "4333331111" }] });
    const l = await ok<{ tipo: string; telefone: string; parentesco: string }[]>(master, "party_referencias_ler", { _party: ana.partyId });
    expect(l.map((x) => [x.tipo, x.telefone, x.parentesco])).toEqual([["referencia", "4333331111", "Vizinho"], ["recado", "43999991111", "Mãe"]]);
    expect((await rpc(repOutro, "party_referencias_ler", { _party: ana.partyId })).erro).not.toBeNull();
  });
});

describe("banho por categoria", () => {
  test("banho vem do cadastro do produto; sem cadastro, do nome; sem nada, 'sem banho'", async () => {
    const r = await um<{ a: string; b: string; c: string; d: string }>(
      `select public.banho_da_peca('prata_925','BR DOU X') a, public.banho_da_peca(null,'BR ARGOLA DOU G') b,
              public.banho_da_peca(null,'AN RODIO ZIRC') c, public.banho_da_peca(null,'BR PONTO DE LUZ') d`);
    expect(r).toEqual({ a: "prata_925", b: "dourado", c: "rodio_branco", d: "sem_banho" });
  });

  test("percentual por categoria com as vendas do histórico", async () => {
    const cod = 900000 + (base % 90000);
    await adm.unsafe(`insert into public.legado_consultoras (codcli, party_id, nome) values ($1,$2,'iso')`, [cod, ana.partyId]);
    await adm.unsafe(`insert into public.legado_produtos (codigo, nome, categoria) values ($1,'BR ARGOLA DOU','BRINCO'),($2,'BR ARGOLA PRATA','BRINCO'),($3,'AN AÇO','ANEL')`, [cod, cod + 1, cod + 2]);
    await adm.unsafe(`insert into public.legado_maleta_vendidos (remessa, codcli, kit, produto, quantidade) values (1,$1,1,$2,5),(1,$1,1,$3,5),(1,$1,1,$4,2)`, [cod, cod, cod + 1, cod + 2]);
    const d = await ok<{ total: number; categorias: { categoria: string; total: number; banhos: { banho: string; pct: number }[] }[] }>(master, "consultora_banhos_categoria", { _party: ana.partyId });
    expect(d.total).toBe(12);
    const br = d.categorias.find((c) => c.categoria === "BRINCO")!;
    expect(br.banhos.map((b) => [b.banho, b.pct]).sort()).toEqual([["dourado", 50], ["prata_banhada", 50]]);
    expect(d.categorias.find((c) => c.categoria === "ANEL")!.banhos).toEqual([{ banho: "aco_inox", qtd: 2, pct: 100 }] as never);
    expect((await rpc(bia, "consultora_banhos_categoria", { _party: ana.partyId })).erro).not.toBeNull();
    expect((await ok<{ total: number }>(ana, "consultora_banhos_categoria", { _party: ana.partyId })).total).toBe(12);
  });
});
