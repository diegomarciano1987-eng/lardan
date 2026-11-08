/**
 * 0269 (Diego, 08/11/2026) — qualquer movimento em nome de consultora inativa a ativa na hora.
 * Caso real: o representante gerava convite para consultora inativa da carteira dele e nada acontecia.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, ler, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 700000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, rep: Conta, repOutro: Conta;
let praca = "", remessa = "";

async function consultora(nome: string, status: "inativo" | "bloqueado" | "desligado", dono: string) {
  const id = (await um<{ id: string }>(
    `insert into public.parties (kind, display_name, legal_name, status, is_active) values ('pessoa',$1,$1,$2,false) returning id`, [nome, status])).id;
  await adm.unsafe(`insert into public.party_roles (party_id, role, status) values ($1,'consultora','inativo')`, [id]);
  await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)`, [id, dono, praca]);
  return id;
}
const situacao = (id: string) => um<{ p: string; r: string; ativo: boolean }>(
  `select p.status::text p, pr.status::text r, p.is_active ativo from public.parties p
     join public.party_roles pr on pr.party_id=p.id and pr.role='consultora' where p.id=$1`, [id]);
const hash = () => Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

beforeAll(async () => {
  master = await criarConta({ nome: `mv69-master-${base}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `mv69-rep-${base}`, papeis: ["representante"], comParty: true });
  repOutro = await criarConta({ nome: `mv69-rep2-${base}`, papeis: ["representante"], comParty: true });
  const deposito = await criarDeposito(`mv69-${marca}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`MV69 ${marca}`])).linhas[0]!.id;
  remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) })).dados.id;
});

describe("convite do representante (o caso do vídeo)", () => {
  test("convite para consultora inativa da carteira dele é criado e ela fica ativa na hora", async () => {
    const id = await consultora(`Gracielle Teste ${marca}`, "inativo", rep.partyId);
    const r = await rpc<{ ok: boolean; id?: string }>(rep, "access_invite_create",
      { _party: id, _email: `grac${marca}@teste.com`, _roles: ["consultora"], _token_hash: hash() });
    expect(r.erro).toBeNull();
    expect(r.dados.ok).toBe(true);
    expect(await situacao(id)).toEqual({ p: "ativo", r: "ativo", ativo: true });
    const a = await um<{ n: number; origem: string }>(
      `select count(*)::int n, max(payload->>'origem') origem from public.audit_logs where action='consultora.ativada_movimento' and entity_id=$1`, [id]);
    expect(a).toEqual({ n: 1, origem: "access_invites:insert" });
  });

  test("representante de outra carteira continua sem poder convidar (e ela segue inativa)", async () => {
    const id = await consultora(`Alheia Teste ${marca}`, "inativo", rep.partyId);
    const r = await rpc(repOutro, "access_invite_create", { _party: id, _email: `alheia${marca}@teste.com`, _roles: ["consultora"], _token_hash: hash() });
    expect(r.ok).toBe(false);
    expect((await situacao(id)).p).toBe("inativo");
  });

  test("representante não ganha poder de ativar cadastro direto (consultora_ativar segue só da equipe)", async () => {
    const id = await consultora(`Direta Teste ${marca}`, "inativo", rep.partyId);
    const r = await rpc(rep, "consultora_ativar", { _party: id });
    expect(r.ok).toBe(false);
    expect(r.erro ?? "").toMatch(/Sem permissão/);
  });
});

describe("outros movimentos", () => {
  test("maleta aberta para inativa a ativa", async () => {
    const id = await consultora(`Maleta Teste ${marca}`, "inativo", rep.partyId);
    const r = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: id });
    expect(r.erro).toBeNull();
    expect(await situacao(id)).toEqual({ p: "ativo", r: "ativo", ativo: true });
  });

  test("bloqueada e desligada nunca são ativadas por movimento", async () => {
    for (const st of ["bloqueado", "desligado"] as const) {
      const id = await consultora(`${st} Teste ${marca}`, st, rep.partyId);
      await adm.unsafe(`insert into public.consultant_clients (consultora_party_id, nome) values ($1,'Cliente X')`, [id]).catch(() => undefined);
      await adm.unsafe(`select public.consultora_ativar_por_movimento($1, null, 'teste')`, [id]);
      expect((await situacao(id)).p).toBe(st);
    }
  });

  test("troca do histórico SmallData não ativa; troca nova ativa", async () => {
    const id = await consultora(`Troca Teste ${marca}`, "inativo", rep.partyId);
    await adm.unsafe(`insert into public.qualidade_trocas (origem, consultora_party_id, tipo, status, legado_id)
                      values ('legado_smalldata',$1,'troca','resolvida',$2)`, [id, `mv69-${marca}`]).catch((e) => { throw e; });
    expect((await situacao(id)).p).toBe("inativo");
    await adm.unsafe(`insert into public.qualidade_trocas (origem, consultora_party_id, tipo, status)
                      values ('admin_manual',$1,'troca','aberta')`, [id]);
    expect((await situacao(id)).p).toBe("ativo");
  });

  test("a busca da maleta do representante mostra a inativa da carteira, nunca a bloqueada", async () => {
    const ina = await consultora(`Buscada Inativa ${marca}`, "inativo", rep.partyId);
    const blq = await consultora(`Buscada Bloq ${marca}`, "bloqueado", rep.partyId);
    const r = await rpc<{ id: string }[]>(rep, "rep_maleta_destinatarias", { _rep: rep.partyId, _busca: `buscada ${marca}` });
    const ids = r.dados.map((x) => x.id);
    expect(ids).toContain(ina);
    expect(ids).not.toContain(blq);
  });

  test("ativação por movimento é só do servidor", async () => {
    const id = await consultora(`Servidor Teste ${marca}`, "inativo", rep.partyId);
    const r = await rpc(rep, "consultora_ativar_por_movimento", { _party: id, _actor: rep.uid, _origem: "tentativa" });
    expect(r.ok).toBe(false);
    expect((await situacao(id)).p).toBe("inativo");
  });
});
