/**
 * 0198 — representante envia convite só para a própria carteira. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const hash = () => (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 64);
let master: Conta, rep: Conta, rep2: Conta, minha: Conta, outra: Conta, semConta = "";

beforeAll(async () => {
  master = await criarConta({ nome: `rc-master-${marca}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `rc-rep-${marca}`, papeis: ["representante"], comParty: true });
  rep2 = await criarConta({ nome: `rc-rep2-${marca}`, papeis: ["representante"], comParty: true });
  minha = await criarConta({ nome: `rc-minha-${marca}`, papeis: ["consultora"], comParty: true });
  outra = await criarConta({ nome: `rc-outra-${marca}`, papeis: ["consultora"], comParty: true });
  semConta = ((await adm.unsafe(`insert into public.parties (display_name, kind) values ($1,'pessoa') returning id`, [`rc-nova-${marca}`])) as { id: string }[])[0]!.id;
  for (const [p, r] of [[minha.partyId!, rep], [semConta, rep], [outra.partyId!, rep2]] as [string, Conta][]) {
    await adm.unsafe(`insert into public.party_roles (party_id, role, status) values ($1,'consultora','ativo') on conflict (party_id, role) do update set status='ativo'`, [p]);
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id) values ($1,$2)
      on conflict (party_id) do update set representative_party_id=excluded.representative_party_id`, [p, r.partyId]);
  }
});

describe("Enviar convite pelo representante", () => {
  test("lista só a carteira dele, mostrando quem já tem acesso", async () => {
    const r = await rpc<{ total: number; com_acesso: number; itens: { id: string; conta_email: string | null }[] }>(rep, "rep_convites_lista", { _rep: rep.partyId, _busca: null });
    expect(r.erro).toBeFalsy();
    const ids = r.dados.itens.map((i) => i.id);
    expect(ids).toContain(semConta);
    expect(ids).toContain(minha.partyId);
    expect(ids).not.toContain(outra.partyId);
    expect(r.dados.itens[0]!.conta_email).toBeNull(); // sem acesso vem primeiro
  });
  test("não lê a carteira de outro representante", async () => {
    const r = await rpc(rep, "rep_convites_lista", { _rep: rep2.partyId, _busca: null });
    expect(r.erro).toMatch(/Sem acesso/);
  });
  test("convida consultora da carteira, reenvia e revoga", async () => {
    expect((await rpc(rep, "consultora_acesso_situacao", { _party: semConta })).erro).toBeFalsy();
    const c = await rpc<{ ok: boolean; id: string }>(rep, "access_invite_create", { _party: semConta, _email: `nova-${marca}@teste.dev`, _roles: ["consultora"], _token_hash: hash() });
    expect(c.erro).toBeFalsy(); expect(c.dados.ok).toBe(true);
    expect((await rpc(rep, "access_invite_envio", { _id: c.dados.id, _ok: true, _erro: null })).erro).toBeFalsy();
    const ev = (await adm.unsafe(`select actor_id from public.access_invite_events where invite_id=$1 and evento='criado'`, [c.dados.id])) as { actor_id: string }[];
    expect(ev[0]!.actor_id).toBe(rep.uid);
    await adm.unsafe(`update public.access_invites set ultimo_envio_at=now()-interval '2 minutes' where id=$1`, [c.dados.id]);
    expect((await rpc(rep, "access_invite_resend", { _id: c.dados.id, _token_hash: hash() })).erro).toBeFalsy();
    expect((await rpc(rep, "access_invite_revoke", { _id: c.dados.id })).erro).toBeFalsy();
  });
  test("recusa consultora de outra carteira e papéis além de consultora", async () => {
    expect((await rpc(rep, "consultora_acesso_situacao", { _party: outra.partyId })).erro).toMatch(/Sem permissão/);
    expect((await rpc(rep, "access_invite_create", { _party: outra.partyId, _email: `x-${marca}@teste.dev`, _roles: ["consultora"], _token_hash: hash() })).erro).toMatch(/Sem permissão/);
    expect((await rpc(rep, "access_invite_create", { _party: semConta, _email: `y-${marca}@teste.dev`, _roles: ["representante"], _token_hash: hash() })).erro).toMatch(/não pode conceder/);
  });
  test("Master continua convidando como antes", async () => {
    const c = await rpc<{ ok: boolean }>(master, "access_invite_create", { _party: outra.partyId, _email: `m-${marca}@teste.dev`, _roles: ["consultora"], _token_hash: hash() });
    expect(c.erro).toBeFalsy();
  });
});
