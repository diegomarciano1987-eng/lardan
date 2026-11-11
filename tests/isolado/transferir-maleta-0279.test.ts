/**
 * 0279 (Diego, 11/11/2026) — transferir a maleta de uma consultora para outra em dois momentos:
 * (1) depois da montagem, antes da nota; (2) já na rua, a caminho dela, com nota e promissória.
 * Vale para a equipe (Daniel/Master) e para o representante. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, type Conta } from "./base";

/** Executor interno do servidor (service_role), como o servidor faz. */
async function servico<T>(sql: string, p: unknown[] = []): Promise<{ ok: boolean; dados: T; erro: string | null }> {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
    return { ok: true, dados: ((await c.unsafe(sql, p)) as { r: T }[])[0]!.r, erro: null };
  } catch (e) {
    return { ok: false, dados: null as T, erro: (e as Error).message };
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 700000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, rep: Conta, repOutro: Conta, joice: Conta, ana: Conta, maria: Conta, bia: Conta, carla: Conta, dora: Conta, eva: Conta, fora: Conta;
let deposito = "", vA = "", praca = "", remessa = "";
let mMaria = "", mCarla = "", mDora = "", mJoice = "", mEva = "", leadNova = "";
const tok = (s: string) => `tr79-${marca}-${s}`;

function cpf(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (arr: number[]) => { const s = arr.reduce((a, d, i) => a + d * (arr.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(n); const d2 = dv([...n, d1]);
  return [...n, d1, d2].join("");
}
async function lead(nome: string) {
  const doc = cpf();
  return (await um<{ id: string }>(
    `insert into public.leads (full_name, whatsapp, city, uf, privacy_version, stage_id, representante_party_id, cpf, cpf_digits)
     values ($1,'43999996666','Ibaiti','PR','v1',(select id from public.candidatura_stages order by sort_order limit 1),$2,$3,$3) returning id`,
    [nome, rep.partyId, doc])).id;
}
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
async function promissoria(cycle: string, party: string, status: "pendente" | "assinado", t: string) {
  await adm.unsafe(`insert into public.assinaturas_digitais (provedor, ambiente, tipo, party_id, cycle_id, doc_token, status, titulo, texto_hash)
                    values ('zapsign','producao','promissoria',$1,$2,$3,$4,'Promissória teste','x')`, [party, cycle, t, status]);
}
const transitoPara = async (cycle: string, para: string) =>
  um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 and status='transito' and to_party_id=$2 order by seq desc limit 1`, [cycle, para]);

beforeAll(async () => {
  master = await criarConta({ nome: `tr79-master-${base}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `tr79-rep-${base}`, papeis: ["representante"], comParty: true });
  repOutro = await criarConta({ nome: `tr79-rep2-${base}`, papeis: ["representante"], comParty: true });
  joice = await criarConta({ nome: `tr79-joice-${base}`, papeis: ["consultora"], comParty: true });
  ana = await criarConta({ nome: `tr79-ana-${base}`, papeis: ["consultora"], comParty: true });
  maria = await criarConta({ nome: `tr79-maria-${base}`, papeis: ["consultora"], comParty: true });
  bia = await criarConta({ nome: `tr79-bia-${base}`, papeis: ["consultora"], comParty: true });
  carla = await criarConta({ nome: `tr79-carla-${base}`, papeis: ["consultora"], comParty: true });
  dora = await criarConta({ nome: `tr79-dora-${base}`, papeis: ["consultora"], comParty: true });
  eva = await criarConta({ nome: `tr79-eva-${base}`, papeis: ["consultora"], comParty: true });
  fora = await criarConta({ nome: `tr79-fora-${base}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`tr79-${marca}`);
  vA = await criarVariante(`tr79-a-${marca}`, 10000);
  await porEstoque(vA, deposito, 80);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`TR79 ${marca}`])).linhas[0]!.id;
  for (const c of [joice, ana, maria, bia, carla, dora, eva]) {
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                      on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`,
      [c.partyId, rep.partyId, praca]);
  }
  remessa = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) })).id;

  // Maletas que vão para a rua: conferidas, entregues ao representante, ele confirma
  mMaria = await montarConferida(maria);
  mCarla = await montarConferida(carla);
  mDora = await montarConferida(dora);
  await ok(master, "remessa_expedir_representante", { _remessa: remessa });
  for (const m of [mMaria, mCarla, mDora]) {
    await ok(rep, "kit_transfer_confirm", { _transfer: (await transitoPara(m, rep.partyId!)).id, _payload: {} });
  }
  // Maria: nota autorizada + promissória assinada + entregue em mãos (ela ainda não confirmou)
  await adm.unsafe(`insert into public.fiscal_focus_envios (ref, ambiente, operacao, payload, status, numero, chave_nfe, cycle_id, party_id)
                    values ($1,'producao','remessa','{}'::jsonb,'autorizado',195,$2,$3,$4)`, [`tr79m${marca}`.slice(0, 40), "5".repeat(44), mMaria, maria.partyId]);
  await promissoria(mMaria, maria.partyId!, "assinado", tok("maria"));
  await ok(rep, "kit_transfer_forward", { _cycle: mMaria, _payload: { note: "Entregue em mãos" } });
  // Carla: entregue em mãos e ela confirmou que recebeu (sem aceite)
  await ok(rep, "kit_transfer_forward", { _cycle: mCarla, _payload: { note: "Entregue em mãos" } });
  await ok(carla, "kit_transfer_confirm", { _transfer: (await transitoPara(mCarla, carla.partyId!)).id, _payload: {} });
  // Dora: recebeu e aceitou
  await ok(rep, "kit_transfer_forward", { _cycle: mDora, _payload: { note: "Entregue em mãos" } });
  await ok(dora, "kit_transfer_confirm", { _transfer: (await transitoPara(mDora, dora.partyId!)).id, _payload: {} });
  await ok(dora, "kit_aceitar", { _cycle: mDora, _itens: [{ variant_id: vA, qty_accepted: 2, qty_divergent: 0 }], _idempotency_key: `tr79-${marca}` });

  // Momento 1: maletas só conferidas (depois da expedição acima, para não saírem junto)
  mJoice = await montarConferida(joice);
  await promissoria(mJoice, joice.partyId!, "pendente", tok("joice"));
  mEva = await montarConferida(eva);
  await adm.unsafe(`insert into public.fiscal_focus_envios (ref, ambiente, operacao, payload, status, cycle_id, party_id)
                    values ($1,'producao','remessa','{}'::jsonb,'processando_autorizacao',$2,$3)`, [`tr79e${marca}`.slice(0, 40), mEva, eva.partyId]);
  leadNova = await lead(`Nova Abertura ${marca}`);
});

describe("Momento 1 — depois da montagem, antes da nota (equipe)", () => {
  test("prévia mostra o momento e a promissória pendente, sem trava", async () => {
    const p = await ok<{ momento: string; promissoria: string; bloqueio: string | null; consultora: string }>(master, "maleta_transferir_previa", { _cycle: mJoice });
    expect(p).toMatchObject({ momento: "antes_da_nota", promissoria: "pendente", bloqueio: null });
  });

  test("representante e consultora não usam a transferência da equipe; ninguém chama o núcleo direto", async () => {
    expect((await rpc(rep, "remessa_maleta_transferir", { _cycle: mJoice, _consultora: ana.partyId, _motivo: "troca teste" })).erro ?? "").toMatch(/Sem permissão/);
    expect((await rpc(joice, "remessa_maleta_transferir", { _cycle: mJoice, _consultora: ana.partyId, _motivo: "troca teste" })).ok).toBe(false);
    const direto = await rpc(master, "maleta_transferir_exec", { _cycle: mJoice, _consultora: ana.partyId, _lead: null, _abertura: false, _motivo: "x", _rep: null, _origem: "equipe" });
    expect(direto.erro ?? "").toMatch(/permission denied/);
  });

  test("exige motivo e consultora da praça", async () => {
    expect((await rpc(master, "remessa_maleta_transferir", { _cycle: mJoice, _consultora: ana.partyId, _motivo: "ab" })).erro ?? "").toMatch(/motivo/);
    expect((await rpc(master, "remessa_maleta_transferir", { _cycle: mJoice, _consultora: fora.partyId, _motivo: "troca teste" })).erro ?? "").toMatch(/praça/);
  });

  test("Joice → Ana: maleta muda, promissória pendente é cancelada e vai para a recusa na ZapSign", async () => {
    const r = await ok<{ consultora_party_id: string; zapsign_cancelar: string[]; tinha_promissoria: boolean; pendencia_fiscal: boolean }>(
      master, "remessa_maleta_transferir", { _cycle: mJoice, _consultora: ana.partyId, _motivo: "Joice desistiu antes da nota" });
    expect(r.consultora_party_id).toBe(ana.partyId!);
    expect(r.zapsign_cancelar).toEqual([tok("joice")]);
    expect(r.tinha_promissoria).toBe(true);
    expect(r.pendencia_fiscal).toBe(false);
    expect((await um<{ c: string }>(`select consultora_party_id::text c from public.kit_cycles where id=$1`, [mJoice])).c).toBe(ana.partyId!);
    const a = await um<{ status: string; inv: boolean; fila: boolean }>(
      `select status, invalidada_em is not null inv, zapsign_cancelar_em is not null fila from public.assinaturas_digitais where doc_token=$1`, [tok("joice")]);
    expect(a).toEqual({ status: "cancelado", inv: true, fila: true });
    expect((await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='maleta.transferida' and entity_id=$1`, [mJoice])).n).toBe(1);
  });

  test("fila da ZapSign: servidor pega a recusa, marca feita e retorno tardio não ressuscita", async () => {
    const f = await servico<{ doc_token: string }[]>(`select public.assinaturas_zapsign_cancelar_fila(50) r`);
    expect(f.erro).toBeNull();
    expect(f.dados.map((x) => x.doc_token)).toContain(tok("joice"));
    expect((await rpc(master, "assinaturas_zapsign_cancelar_fila", { _limite: 5 })).ok).toBe(false);
    expect((await servico(`select public.assinatura_zapsign_cancelada($1,'recusado') r`, [tok("joice")])).erro).toBeNull();
    expect((await servico<{ repetida: boolean }>(`select public.assinatura_zapsign_cancelada($1) r`, [tok("joice")])).dados.repetida).toBe(true);
    const ret = await servico<{ status: string; invalidada: boolean }>(`select public.assinatura_retorno($1,'signed',null) r`, [tok("joice")]);
    expect(ret.dados).toMatchObject({ status: "cancelado", invalidada: true });
    expect((await um<{ s: string }>(`select status s from public.assinaturas_digitais where doc_token=$1`, [tok("joice")])).s).toBe("cancelado");
  });

  test("Ana → ABERTURA com o representante: sem consultora e com número", async () => {
    const r = await ok<{ consultora_party_id: string | null; abertura_numero: number }>(
      master, "remessa_maleta_transferir", { _cycle: mJoice, _consultora: null, _motivo: "vira abertura do representante" });
    expect(r.consultora_party_id).toBeNull();
    expect(r.abertura_numero).toBeGreaterThanOrEqual(1);
    const c = await um<{ c: string | null; n: number }>(`select consultora_party_id::text c, abertura_numero n from public.kit_cycles where id=$1`, [mJoice]);
    expect(c).toEqual({ c: null, n: r.abertura_numero });
  });

  test("nota sendo emitida agora: trava com aviso claro", async () => {
    const p = await ok<{ bloqueio: string }>(master, "maleta_transferir_previa", { _cycle: mEva });
    expect(p.bloqueio).toMatch(/sendo emitida agora/);
    expect((await rpc(master, "remessa_maleta_transferir", { _cycle: mEva, _consultora: ana.partyId, _motivo: "troca teste" })).erro ?? "").toMatch(/sendo emitida agora/);
  });
});

describe("Momento 2 — na rua, a caminho dela, com nota e promissória", () => {
  test("prévia: com nota, entrega em mãos pendente e promissória assinada", async () => {
    const p = await ok<Record<string, unknown>>(master, "maleta_transferir_previa", { _cycle: mMaria });
    expect(p).toMatchObject({ momento: "com_nota", entrega_pendente: true, promissoria: "assinada", nota_numero: "195", bloqueio: null });
    // o representante da maleta também vê; outro representante não
    expect((await rpc(rep, "maleta_transferir_previa", { _cycle: mMaria })).erro).toBeNull();
    expect((await rpc(repOutro, "maleta_transferir_previa", { _cycle: mMaria })).erro ?? "").toMatch(/Sem permissão/);
  });

  test("equipe Maria → Bia: entrega cancelada, promissória assinada guardada como substituída, pendência fiscal", async () => {
    const r = await ok<{ consultora_party_id: string; pendencia_fiscal: boolean; entregas_canceladas: number; zapsign_cancelar: string[] }>(
      master, "remessa_maleta_transferir", { _cycle: mMaria, _consultora: bia.partyId, _motivo: "Maria não atendeu, fica com a Bia" });
    expect(r).toMatchObject({ consultora_party_id: bia.partyId, pendencia_fiscal: true, entregas_canceladas: 1, zapsign_cancelar: [] });
    expect((await um<{ s: string }>(`select status s from public.kit_transfers where cycle_id=$1 and to_party_id=$2 order by seq desc limit 1`, [mMaria, maria.partyId])).s).toBe("cancelada");
    const a = await um<{ status: string; inv: boolean; fila: boolean }>(
      `select status, invalidada_em is not null inv, zapsign_cancelar_em is not null fila from public.assinaturas_digitais where doc_token=$1`, [tok("maria")]);
    expect(a).toEqual({ status: "assinado", inv: true, fila: false });
    const p = await um<Record<string, unknown>>(`select status, origem, nota_numero, consultora_anterior_party_id::text anterior, consultora_nova_party_id::text nova
                                                  from public.maleta_troca_pendencias where cycle_id=$1`, [mMaria]);
    expect(p).toEqual({ status: "aberta", origem: "equipe", nota_numero: "195", anterior: maria.partyId, nova: bia.partyId });
    const c = await um<{ status: string; cust: string }>(`select status::text, custodian_party_id::text cust from public.kit_cycles where id=$1`, [mMaria]);
    expect(c).toEqual({ status: "transito", cust: rep.partyId! });
  });

  test("a maleta aparece para o representante entregar à Bia e some das pendências da Maria", async () => {
    const r = await ok<{ para_entregar: { cycle_id: string; consultora: string }[] }>(rep, "rep_portal_maletas", { _rep: rep.partyId });
    const m = r.para_entregar.find((x) => x.cycle_id === mMaria);
    expect(m?.consultora).toBe(`ISO tr79-bia-${base}`);
    const pend = await ok<{ cycle_id: string }[]>(maria, "consultora_aceites_pendentes", {});
    expect(pend.some((x) => x.cycle_id === mMaria)).toBe(false);
  });

  test("representante: Carla já confirmou que recebeu (sem aceite) → volta para ele e vai para a candidata", async () => {
    expect((await rpc(repOutro, "rep_maleta_trocar_destino", { _rep: rep.partyId, _cycle: mCarla, _consultora: null, _lead: leadNova })).erro ?? "").toMatch(/Sem permissão/);
    const r = await ok<{ consultora_party_id: string; voltou_do_recebimento: boolean; abertura_numero: number; transfer_id: string }>(
      rep, "rep_maleta_trocar_destino", { _rep: rep.partyId, _cycle: mCarla, _consultora: null, _lead: leadNova });
    expect(r.voltou_do_recebimento).toBe(true);
    expect(r.consultora_party_id).not.toBe(carla.partyId);
    expect(r.abertura_numero).toBeGreaterThanOrEqual(1);
    const volta = await um<{ n: number }>(`select count(*)::int n from public.kit_transfers where cycle_id=$1 and from_party_id=$2 and to_party_id=$3 and status='entregue'`,
      [mCarla, carla.partyId, rep.partyId]);
    expect(volta.n).toBe(1);
    const nova = await um<{ para: string }>(`select to_party_id::text para from public.kit_transfers where cycle_id=$1 and status='transito'`, [mCarla]);
    expect(nova.para).toBe(r.consultora_party_id);
    expect((await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='maleta.trocada_para_abertura' and entity_id=$1`, [mCarla])).n).toBe(1);
  });

  test("com aceite feito: não transfere (nem equipe, nem representante)", async () => {
    expect((await rpc(master, "remessa_maleta_transferir", { _cycle: mDora, _consultora: ana.partyId, _motivo: "troca teste" })).erro ?? "").toMatch(/já aceitou|em uso/);
    const r = await rpc(rep, "rep_maleta_trocar_destino", { _rep: rep.partyId, _cycle: mDora, _consultora: ana.partyId, _lead: null });
    expect(r.ok).toBe(false);
    expect((await um<{ c: string }>(`select consultora_party_id::text c from public.kit_cycles where id=$1`, [mDora])).c).toBe(dora.partyId!);
  });

  test("consultora que já tem maleta na remessa não recebe outra", async () => {
    // Bia já tem a maleta da Maria
    expect((await rpc(master, "remessa_maleta_transferir", { _cycle: mJoice, _consultora: bia.partyId, _motivo: "troca teste" })).erro ?? "").toMatch(/já tem maleta/);
  });
});
