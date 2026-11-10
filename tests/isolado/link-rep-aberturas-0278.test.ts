/**
 * 0278 (Diego, 10/11/2026) — candidata que se cadastra pelo link do representante (?rep=lc-000000) entra na
 * carteira dele na hora; maletas de abertura chegam ao app dele com o número do pedido e em ordem;
 * o card do painel mostra o representante. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 100000 + Math.floor(Math.random() * 800000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, rep: Conta, repOutro: Conta;
let codigo = "", deposito = "", vA = "", praca = "", remessa = "";

function cpf(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (arr: number[]) => { const s = arr.reduce((a, d, i) => a + d * (arr.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(n); const d2 = dv([...n, d1]);
  return [...n, d1, d2].join("");
}
const zap = () => `4399${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
function candidatura(doc: string, whatsapp: string, tracking: Record<string, unknown>) {
  return rpc<{ protocol: string; duplicate: boolean }>(null, "submit_candidatura", {
    _payload: { first_name: "Larissa", last_name: `Link ${marca}`, cpf: doc, whatsapp, city: "Cornélio Procópio", uf: "PR", privacy_version: "v1" },
    _tracking: tracking,
  });
}
const leadPorCpf = (doc: string) =>
  um<{ id: string; representante_party_id: string | null; representante_origem: string | null }>(
    `select id, representante_party_id, representante_origem from public.leads where cpf_digits=$1 order by created_at desc limit 1`, [doc]);

beforeAll(async () => {
  master = await criarConta({ nome: `l78-master-${base}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `l78-rep-${base}`, papeis: ["representante"], comParty: true });
  repOutro = await criarConta({ nome: `l78-rep2-${base}`, papeis: ["representante"], comParty: true });
  codigo = `lc-${String(base).padStart(6, "0")}`;
  await adm.unsafe(`update public.parties set code=$2 where id=$1`, [rep.partyId, codigo.toUpperCase()]);
  for (const r of [rep, repOutro]) {
    await adm.unsafe(`insert into public.party_roles (party_id, role, status, started_at)
                      select $1, 'representante', 'ativo', current_date
                      where not exists (select 1 from public.party_roles where party_id=$1 and role='representante')`, [r.partyId]);
    await adm.unsafe(`update public.party_roles set status='ativo' where party_id=$1 and role='representante'`, [r.partyId]);
  }
  deposito = await criarDeposito(`l78-${marca}`);
  vA = await criarVariante(`l78-a-${marca}`, 10000);
  await porEstoque(vA, deposito, 50);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`L78 ${marca}`])).linhas[0]!.id;
  remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) })).dados.id;
});

describe("cadastro pelo link do representante", () => {
  test("entra na carteira dele na hora, com origem 'link', e aparece no app dele", async () => {
    const doc = cpf();
    const r = await candidatura(doc, zap(), { representante: codigo });
    expect(r.erro).toBeNull();
    const l = await leadPorCpf(doc);
    expect(l.representante_party_id).toBe(rep.partyId);
    expect(l.representante_origem).toBe("link");
    const crm = await rpc<{ cards: { lead_id: string; origem: string }[] }>(rep, "rep_crm", { _rep: rep.partyId });
    expect(crm.erro).toBeNull();
    expect(crm.dados.cards.find((c) => c.lead_id === l.id)?.origem).toBe("link");
  });

  test("código inexistente não liga a ninguém pelo link", async () => {
    const doc = cpf();
    expect((await candidatura(doc, zap(), { representante: "lc-999999" })).erro).toBeNull();
    const l = await leadPorCpf(doc);
    expect(l.representante_origem).not.toBe("link");
    expect(l.representante_party_id).not.toBe(rep.partyId);
  });

  test("reenvio pelo link liga quem estava sem representante, mas nunca tira de outro", async () => {
    const semRep = cpf(); const w1 = zap();
    await candidatura(semRep, w1, {});
    expect((await leadPorCpf(semRep)).representante_party_id).toBeNull();
    const r = await candidatura(semRep, w1, { representante: codigo });
    expect(r.dados.duplicate).toBe(true);
    expect(await leadPorCpf(semRep)).toMatchObject({ representante_party_id: rep.partyId, representante_origem: "link" });

    const doOutro = cpf(); const w2 = zap();
    await candidatura(doOutro, w2, {});
    const l2 = await leadPorCpf(doOutro);
    await adm.unsafe(`update public.leads set representante_party_id=$2, representante_origem='manual' where id=$1`, [l2.id, repOutro.partyId]);
    await candidatura(doOutro, w2, { representante: codigo });
    expect(await leadPorCpf(doOutro)).toMatchObject({ representante_party_id: repOutro.partyId, representante_origem: "manual" });
  });

  test("o card do painel traz o nome do representante", async () => {
    const doc = cpf();
    await candidatura(doc, zap(), { representante: codigo });
    const l = await leadPorCpf(doc);
    const card = (await um<{ c: { representante_id: string; representante: string; representante_origem: string } }>(
      `select public.crm_card(l) c from public.leads l where l.id=$1`, [l.id])).c;
    expect(card.representante_id).toBe(rep.partyId);
    expect(card.representante).toBe(`ISO l78-rep-${base}`);
    expect(card.representante_origem).toBe("link");
  });
});

describe("maletas de abertura no app do representante", () => {
  const abertas: { cycle_id: string; abertura_numero: number }[] = [];
  beforeAll(async () => {
    for (let i = 0; i < 3; i++) {
      const a = (await rpc<{ cycle_id: string; abertura_numero: number }>(master, "remessa_abrir_maleta_representante", { _remessa: remessa })).dados;
      abertas.push(a);
      await rpc(master, "kit_item_upsert", { _cycle: a.cycle_id, _variant: vA, _qty: 3 - i }); // valores diferentes
      await rpc(master, "kit_conferir", { _cycle: a.cycle_id, _note: null });
    }
    // expede na ordem inversa, para provar que a lista não depende da ordem de saída
    for (const a of [...abertas].reverse()) {
      await rpc(master, "kit_expedir", { _cycle: a.cycle_id, _payload: { rota: "representante" } });
      const t = (await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 order by seq desc limit 1`, [a.cycle_id])).id;
      await rpc(rep, "kit_transfer_confirm", { _transfer: t, _payload: {} });
    }
  });

  test("cada maleta traz o número ABERTURA do pedido e a lista vem em ordem 01, 02, 03", async () => {
    const r = await rpc<{ sem_consultora: { cycle_id: string; abertura_numero: number; remessa: number }[] }>(rep, "rep_portal_maletas", { _rep: rep.partyId });
    expect(r.erro).toBeNull();
    const minhas = r.dados.sem_consultora.filter((m) => abertas.some((a) => a.cycle_id === m.cycle_id));
    expect(minhas.length).toBe(3);
    expect(minhas.map((m) => m.abertura_numero)).toEqual([...abertas].map((a) => a.abertura_numero).sort((x, y) => x - y));
    for (const m of minhas) expect(m.abertura_numero).toBe(abertas.find((a) => a.cycle_id === m.cycle_id)!.abertura_numero);
    expect(minhas.map((m) => m.cycle_id)).toEqual(abertas.map((a) => a.cycle_id));
  });

  test("outro representante não lê as maletas dele", async () => {
    expect((await rpc(repOutro, "rep_portal_maletas", { _rep: rep.partyId })).ok).toBe(false);
  });
});
