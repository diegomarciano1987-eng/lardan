/**
 * 0266 (Daniel, 08/11/2026) — busca da maleta de abertura acha a candidata cadastrada na rua,
 * numeração ABERTURA/MALETA na remessa e rodízio da conferência de assinaturas pendentes.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";

async function servico<T>(sql: string): Promise<T | null> {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
    return ((await c.unsafe(sql)) as { r: T }[])[0]?.r ?? null;
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 600000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, rep: Conta, repOutro: Conta, cons: Conta;
let deposito = "", vA = "", praca = "", remessa = "";

function cpf(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (arr: number[]) => { const s = arr.reduce((a, d, i) => a + d * (arr.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(n); const d2 = dv([...n, d1]);
  return [...n, d1, d2].join("");
}
async function lead(nome: string, repId: string, partyId: string | null, cpfDigits: string | null) {
  return (await um<{ id: string }>(
    `insert into public.leads (full_name, whatsapp, city, uf, privacy_version, stage_id, representante_party_id, party_id, cpf, cpf_digits)
     values ($1,'43999998888','Ibaiti','PR','v1',(select id from public.candidatura_stages order by sort_order limit 1),$2,$3,$4,$4) returning id`,
    [nome, repId, partyId, cpfDigits])).id;
}
async function pessoa(nome: string, doc: string, status = "ativo") {
  return (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, doc, doc_digits, status) values ('pessoa',$1,$1,$2,$2,$3) returning id`, [nome, doc, status])).id;
}

beforeAll(async () => {
  master = await criarConta({ nome: `ab66-master-${base}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `ab66-rep-${base}`, papeis: ["representante"], comParty: true });
  repOutro = await criarConta({ nome: `ab66-rep2-${base}`, papeis: ["representante"], comParty: true });
  cons = await criarConta({ nome: `ab66-cons-${base}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`ab66-${marca}`);
  vA = await criarVariante(`ab66-a-${marca}`, 10000);
  await porEstoque(vA, deposito, 50);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`AB66 ${marca}`])).linhas[0]!.id;
  await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                    on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`,
    [cons.partyId, rep.partyId, praca]);
  remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) })).dados.id;
});

describe("busca da maleta de abertura (rep_maleta_destinatarias)", () => {
  const doc = cpf();
  let leadNova = "", leadOutra = "", leadBloq = "";
  beforeAll(async () => {
    // cadastrada na rua: já tem pessoa (com outro nome curto no cadastro), ainda sem perfil de consultora
    const p = await pessoa(`zuleica${marca}`, doc);
    leadNova = await lead(`Zuleica Pelegrini ${marca}`, rep.partyId, p, doc);
    // pessoa que já é consultora de outro representante: nunca aparece como candidata dele
    const p2 = await pessoa(`Outra Pelegrini ${marca}`, cpf());
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)`, [p2, repOutro.partyId, praca]);
    leadOutra = await lead(`Outra Pelegrini ${marca}`, rep.partyId, p2, null);
    // bloqueada: não recebe maleta
    const p3 = await pessoa(`Bloq Pelegrini ${marca}`, cpf(), "bloqueado");
    leadBloq = await lead(`Bloq Pelegrini ${marca}`, rep.partyId, p3, null);
  });

  test("acha a candidata recém-cadastrada pelo nome completo, fora de ordem", async () => {
    const r = await rpc<{ tipo: string; id: string }[]>(rep, "rep_maleta_destinatarias", { _rep: rep.partyId, _busca: `pelegrini zuleica ${marca}` });
    expect(r.erro).toBeNull();
    expect(r.dados.filter((x) => x.id === leadNova).map((x) => x.tipo)).toEqual(["candidata"]);
  });

  test("acha pelo CPF", async () => {
    const r = await rpc<{ id: string }[]>(rep, "rep_maleta_destinatarias", { _rep: rep.partyId, _busca: doc.slice(0, 9) });
    expect(r.dados.some((x) => x.id === leadNova)).toBe(true);
  });

  test("não traz consultora de outra carteira nem pessoa bloqueada", async () => {
    const r = await rpc<{ id: string }[]>(rep, "rep_maleta_destinatarias", { _rep: rep.partyId, _busca: `pelegrini ${marca}` });
    const ids = r.dados.map((x) => x.id);
    expect(ids).toContain(leadNova);
    expect(ids).not.toContain(leadOutra);
    expect(ids).not.toContain(leadBloq);
  });

  test("outro representante não enxerga a candidata dele", async () => {
    expect((await rpc(repOutro, "rep_maleta_destinatarias", { _rep: rep.partyId, _busca: "pelegrini" })).ok).toBe(false);
  });

  test("depois de virar consultora dele aparece uma vez só, como consultora", async () => {
    const ab = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta_representante", { _remessa: remessa });
    const c = ab.dados.cycle_id;
    await rpc(master, "kit_item_upsert", { _cycle: c, _variant: vA, _qty: 1 });
    await rpc(master, "kit_conferir", { _cycle: c, _note: null });
    await rpc(master, "kit_expedir", { _cycle: c, _payload: { rota: "representante" } });
    const t = (await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 order by seq desc limit 1`, [c])).id;
    await rpc(rep, "kit_transfer_confirm", { _transfer: t, _payload: {} });
    const passou = await rpc(rep, "rep_maleta_repassar", { _rep: rep.partyId, _cycle: c, _lead: leadNova });
    expect(passou.erro).toBeNull();
    const r = await rpc<{ tipo: string; id: string }[]>(rep, "rep_maleta_destinatarias", { _rep: rep.partyId, _busca: `zuleica ${marca}` });
    expect(r.dados.map((x) => x.tipo)).toEqual(["consultora"]);
  });
});

describe("numeração na tela da remessa (remessa_maletas)", () => {
  test("ABERTURA numerada; maleta da consultora sai MALETA 01 (o banco aceita uma por consultora na remessa)", async () => {
    const a1 = (await rpc<{ cycle_id: string; abertura_numero: number }>(master, "remessa_abrir_maleta_representante", { _remessa: remessa })).dados;
    const m1 = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: cons.partyId })).dados.cycle_id;
    const linhas = await ler<{ cycle_id: string; abertura_numero: number | null; maleta_seq: number | null }>(master, `select * from public.remessa_maletas($1)`, [remessa]);
    const por = new Map(linhas.linhas.map((l) => [l.cycle_id, l]));
    expect(a1.abertura_numero).toBeGreaterThan(0);
    expect(por.get(a1.cycle_id)?.abertura_numero).toBe(a1.abertura_numero);
    expect(por.get(a1.cycle_id)?.maleta_seq).toBeNull();
    expect(por.get(m1)?.maleta_seq).toBe(1);
    expect(por.get(m1)?.abertura_numero).toBeNull();
    // segunda maleta da mesma consultora na mesma remessa continua barrada pela trava existente
    const repetida = await rpc<{ cycle_id: string; repetida?: boolean }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: cons.partyId });
    expect(repetida.dados).toMatchObject({ cycle_id: m1, repetida: true });
  });

  test("consultora e representante não leem a lista da remessa", async () => {
    const r = await ler<{ cycle_id: string }>(cons, `select * from public.remessa_maletas($1)`, [remessa]);
    expect(r.linhas.length).toBe(0);
  });
});

describe("conferência das assinaturas pendentes (rodízio)", () => {
  test("só o servidor chama; marca conferido_em e não repete o mesmo lote", async () => {
    const tok = (s: string) => `00000000-0000-4000-8000-${marca.padEnd(8, "0").slice(0, 8)}${s}`;
    for (const [s, dono] of [["0001", cons.partyId], ["0002", rep.partyId]] as const) {
      await adm.unsafe(`insert into public.assinaturas_digitais (provedor, ambiente, tipo, party_id, doc_token, status, titulo, texto_hash, criado_em)
                        values ('zapsign','producao','contrato',$1,$2,'pendente','Contrato teste','teste', now())`, [dono, tok(s)]);
    }
    expect((await rpc(master, "assinaturas_pendentes_conferir", { _limite: 5 })).ok).toBe(false);
    const primeira = (await servico<{ doc_token: string }[]>(`select public.assinaturas_pendentes_conferir(1) r`))!;
    const segunda = (await servico<{ doc_token: string }[]>(`select public.assinaturas_pendentes_conferir(1) r`))!;
    expect(primeira).toHaveLength(1);
    expect(segunda).toHaveLength(1);
    expect(primeira[0]!.doc_token).not.toBe(segunda[0]!.doc_token);
    const n = await um<{ n: number }>(`select count(*)::int n from public.assinaturas_digitais where doc_token = any($1) and conferido_em is not null`, [[tok("0001"), tok("0002")]]);
    expect(n.n).toBe(2);
  });
});
