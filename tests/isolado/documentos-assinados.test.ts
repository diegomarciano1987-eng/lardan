/**
 * 0228 — documentos assinados no cadastro de quem assinou. Banco ISOLADO, dados sintéticos, sem rede.
 *  1. Quem assinou → cadastro: CPF; senão telefone único; senão e-mail único; ambíguo = nenhum. Só servidor.
 *  2. Documento do painel da ZapSign: registrado como avulso, idempotente, assinado não regride.
 *  3. Cópia do PDF: grava uma vez só.
 *  4. Aba do cadastro: ZapSign + termo da maleta (Clicksign) numa lista; consultora não vê; representante dela vê.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, repC: Conta, cons: Conta, outra: Conta, gemea: Conta;
const tok = () => crypto.randomUUID();
/** CPF válido e único por execução (vários testes usam 529.982.247-25, que fica ambíguo no banco compartilhado). */
function cpfValido(): string {
  const b = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (n: number[]) => { const s = n.reduce((a, d, i) => a + d * (n.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(b); const d2 = dv([...b, d1]);
  return [...b, d1, d2].join("");
}
const CPF = cpfValido();
const FONE = `9${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const FONE2 = `9${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function servico<T>(sql: string, p: unknown[] = []): Promise<{ ok: boolean; dados: T | null; erro: string | null }> {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
    return { ok: true, dados: ((await c.unsafe(sql, p)) as { r: T }[])[0]!.r, erro: null };
  } catch (e) {
    return { ok: false, dados: null, erro: (e as Error).message };
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}
const achar = (cpf: string | null, fone: string | null, email: string | null) =>
  servico<string | null>(`select public.party_por_assinante($1,$2,$3) r`, [cpf, fone, email]);
const avulso = (t: string, party: string, status = "pending") =>
  servico<{ id: string; status: string }>(`select public.assinatura_avulsa_registrar($1::text::jsonb) r`,
    [JSON.stringify({ ambiente: "producao", party_id: party, doc_token: t, signer_token: tok(), status, titulo: "Acordo - teste.pdf", assinante: "Fulana", assinado_em: status === "signed" ? "2026-11-05T12:00:00Z" : "" })]);

beforeAll(async () => {
  master = await criarConta({ nome: `doc-master-${marca}`, papeis: ["master"], comParty: true });
  repC = await criarConta({ nome: `doc-rep-${marca}`, papeis: ["representante"], comParty: true });
  cons = await criarConta({ nome: `doc-cons-${marca}`, papeis: ["consultora"], comParty: true });
  outra = await criarConta({ nome: `doc-outra-${marca}`, papeis: ["consultora"], comParty: true });
  gemea = await criarConta({ nome: `doc-gemea-${marca}`, papeis: ["consultora"], comParty: true });
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'representante') on conflict do nothing`, [repC.partyId]);
  await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id) values ($1,$2)
                    on conflict (party_id) do update set representative_party_id = excluded.representative_party_id`, [cons.partyId, repC.partyId]);
  await adm.unsafe(`update public.parties set doc = $2 where id = $1`, [cons.partyId, CPF]);
  await adm.unsafe(`insert into public.contact_points (party_id, kind, value, is_primary) values
    ($1,'whatsapp','43' || $4,true), ($1,'email','Cons.${marca}@Exemplo.com',false),
    ($2,'whatsapp','43' || $5,true), ($3,'whatsapp','43' || $5,true)`, [cons.partyId, outra.partyId, gemea.partyId, FONE, FONE2]);
});

afterAll(async () => {
  await adm.unsafe(`delete from public.assinaturas_digitais where party_id = any($1::uuid[])`, [[cons.partyId, outra.partyId]]);
});

describe("1. quem assinou", () => {
  test("CPF, telefone único, e-mail único; ambíguo = nenhum; só servidor", async () => {
    expect((await achar(CPF.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4"), null, null)).dados).toBe(cons.partyId);
    expect((await achar(null, `+55 (43) ${FONE}`, null)).dados).toBe(cons.partyId);
    expect((await achar(null, null, ` cons.${marca}@exemplo.com `)).dados).toBe(cons.partyId);
    expect((await achar(null, `5543${FONE2}`, null)).dados).toBeNull();   // dois cadastros com o mesmo telefone
    expect((await achar(null, null, null)).dados).toBeNull();
    expect((await rpc(master, "party_por_assinante", { _cpf: CPF, _fone: null, _email: null })).ok).toBe(false);
  });
});

describe("2 e 3. documento do painel e cópia", () => {
  test("registra avulso, idempotente, não regride; cópia uma vez", async () => {
    const t = tok();
    expect((await avulso(t, cons.partyId!)).dados!.status).toBe("pendente");
    expect((await avulso(t, cons.partyId!, "signed")).dados!.status).toBe("assinado");
    await avulso(t, cons.partyId!, "pending");
    const row = await um<{ status: string; tipo: string; origem: string; n: number }>(
      `select status, tipo, origem, (select count(*)::int from public.assinaturas_digitais where doc_token = $1) n from public.assinaturas_digitais where doc_token = $1`, [t]);
    expect(row).toEqual({ status: "assinado", tipo: "avulso", origem: "zapsign_painel", n: 1 });
    expect((await servico(`select public.assinatura_arquivo_salvar($1,$2,'h1')::text r`, [t, `${cons.partyId}/${t}.pdf`])).erro).toBeNull();
    await servico(`select public.assinatura_arquivo_salvar($1,'outro.pdf','h2')::text r`, [t]);
    expect((await um<{ arquivo_path: string }>(`select arquivo_path from public.assinaturas_digitais where doc_token = $1`, [t])).arquivo_path).toBe(`${cons.partyId}/${t}.pdf`);
    const sem = await servico<{ doc_token: string }[]>(`select public.assinaturas_sem_copia(100) r`);
    expect(sem.dados!.some((x) => x.doc_token === t)).toBe(false);
    expect((await servico<{ party_id: string }>(`select public.assinatura_ler_por_token($1) r`, [t])).dados!.party_id).toBe(cons.partyId);
  });
});

describe("4. aba do cadastro", () => {
  test("lista ZapSign + termo da maleta; permissões", async () => {
    const kit = await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO DOC ${marca}`]);
    const ciclo = await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, status, consultora_party_id) values ($1,1,'recebida',$2) returning id`, [kit.id, cons.partyId]);
    await adm.unsafe(`insert into public.kit_signature_requests (cycle_id, consultora_party_id, signer_user_id, estado, modo, termo_versao, snapshot, snapshot_sha256, idempotency_key, signed_path, finalizado_em)
                      values ($1,$2,$3,'finalizado','sandbox','v0','{}'::jsonb,'s',$4,'x/assinado.pdf',now())`, [ciclo.id, cons.partyId, cons.uid, `iso-${marca}`]);
    const l = await rpc<{ fonte: string; tipo: string; status: string; tem_copia: boolean }[]>(master, "documentos_assinados_da_pessoa", { _party: cons.partyId });
    expect(l.erro).toBeNull();
    expect(l.dados.map((d) => `${d.fonte}:${d.tipo}:${d.status}`).sort()).toEqual(["clicksign:termo_maleta:assinado", "zapsign:avulso:assinado"]);
    expect(l.dados.every((d) => d.tem_copia)).toBe(true);
    expect((await rpc(repC, "documentos_assinados_da_pessoa", { _party: cons.partyId })).ok).toBe(true);
    expect((await rpc(cons, "documentos_assinados_da_pessoa", { _party: cons.partyId })).ok).toBe(false);
    expect((await rpc(repC, "documentos_assinados_da_pessoa", { _party: outra.partyId })).ok).toBe(false);
    await adm.unsafe(`delete from public.kit_signature_requests where idempotency_key = $1`, [`iso-${marca}`]);
  });
});
