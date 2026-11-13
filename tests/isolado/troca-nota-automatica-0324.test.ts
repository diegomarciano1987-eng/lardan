/**
 * 0324 (Diego, 13/11/2026) — maleta trocada ou devolvida com nota já autorizada: a parte fiscal é automática.
 * Nada de "marcar como resolvida": cancela a nota antiga (menos de 23 h e a maleta não saiu da empresa) ou faz
 * a nota de devolução; depois a fila normal emite a remessa de quem ficou com a maleta. Banco ISOLADO, dados sintéticos.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, type Conta } from "./base";

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
async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}
type Plano = { pendencia: string; acao: "cancelar" | "devolucao"; ref: string; itens?: { quantidade: number; preco_varejo_cents: number; numero_item_origem: number }[];
  origem?: { chave: string }; destinatario?: unknown };
type Pend = { id: string; status: string; auto_status: string; auto_acao: string | null; auto_erro: string | null; observacao: string | null; nota_ref: string | null };

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const base = 600000 + Math.floor(Math.random() * 90000);
let master: Conta, rep: Conta, montagem: Conta, ana: Conta, bia: Conta, cris: Conta, dani: Conta, eva: Conta, fabi: Conta, gabi: Conta;
let deposito = "", vA = "", praca = "", remessa = "", original: Record<string, unknown> = {};
let mAna = "", mCris = "", mDani = "", mFabi = "";
let nNota = 900;
const transitoPara = async (cycle: string, para: string) =>
  um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 and status='transito' and to_party_id=$2 order by seq desc limit 1`, [cycle, para]);

async function montarConferida(c: Conta) {
  const id = (await ok<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: c.partyId })).cycle_id;
  await ok(master, "kit_item_upsert", { _cycle: id, _variant: vA, _qty: 2 });
  await ok(master, "kit_conferir", { _cycle: id, _note: null });
  return id;
}
/** Nota de remessa autorizada em produção, como a Focus devolve. */
async function notaAutorizada(cycle: string, party: string, ambiente = "producao", criadaHa = "0 hours") {
  const ref = `t324-${marca}-${nNota}`.slice(0, 40);
  await adm.unsafe(
    `insert into public.fiscal_focus_envios (ref, ambiente, operacao, payload, status, numero, serie, chave_nfe, cycle_id, party_id, created_at)
     values ($1,$2,'remessa',$3::text::jsonb,'autorizado',$4,'3',$5,$6,$7, now() - $8::interval)`,
    [ref, ambiente, JSON.stringify({ items: [
      { codigo_produto: "L1", descricao: "BRINCO", codigo_ncm: "71171900", quantidade_comercial: "2.0000", valor_unitario_comercial: "33.30" },
      { codigo_produto: "L2", descricao: "COLAR", codigo_ncm: "71171900", quantidade_comercial: "1.0000", valor_unitario_comercial: "16.63" },
    ], informacoes_adicionais_contribuinte: "Maleta MAL-T Remessa 1" }), String(nNota++), "4".repeat(43) + String(nNota % 10), cycle, party, criadaHa]);
  return ref;
}
const pend = (cycle: string) => um<Pend>(`select * from public.maleta_troca_pendencias where cycle_id=$1 order by criado_em desc limit 1`, [cycle]);
const vencer = (id: string) => adm.unsafe(`update public.maleta_troca_pendencias set auto_proxima_em = now() - interval '1 minute' where id=$1`, [id]);
const proximas = async () => {
  const r = await servico<Plano[]>(`select public.fiscal_trocas_proximas(20) r`);
  if (!r.ok) throw new Error(r.erro!);
  return r.dados;
};
const fila = (cycle: string) => um<{ status: string } | undefined>(`select status from public.fiscal_fila where cycle_id=$1 and etapa='remessa'`, [cycle]);

beforeAll(async () => {
  original = await um(`select emission_active, provider, environment, producao_piloto_cycle_id, producao_todas, producao_automatico from public.fiscal_settings`);
  master = await criarConta({ nome: `t324-master-${base}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `t324-rep-${base}`, papeis: ["representante"], comParty: true });
  montagem = await criarConta({ nome: `t324-mont-${base}`, papeis: ["montagem"], comParty: true });
  ana = await criarConta({ nome: `t324-ana-${base}`, papeis: ["consultora"], comParty: true });
  bia = await criarConta({ nome: `t324-bia-${base}`, papeis: ["consultora"], comParty: true });
  cris = await criarConta({ nome: `t324-cris-${base}`, papeis: ["consultora"], comParty: true });
  dani = await criarConta({ nome: `t324-dani-${base}`, papeis: ["consultora"], comParty: true });
  eva = await criarConta({ nome: `t324-eva-${base}`, papeis: ["consultora"], comParty: true });
  fabi = await criarConta({ nome: `t324-fabi-${base}`, papeis: ["consultora"], comParty: true });
  gabi = await criarConta({ nome: `t324-gabi-${base}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`t324-${marca}`);
  vA = await criarVariante(`t324-a-${marca}`, 9990);
  await porEstoque(vA, deposito, 80);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`T324 ${marca}`])).linhas[0]!.id;
  for (const c of [ana, bia, cris, dani, eva, fabi, gabi]) {
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                      on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`,
      [c.partyId, rep.partyId, praca]);
  }
  remessa = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) })).id;
  // Cris, Dani e Fabi vão para a rua (representante confirmou); Ana fica só conferida
  mCris = await montarConferida(cris);
  mDani = await montarConferida(dani);
  mFabi = await montarConferida(fabi);
  await ok(master, "remessa_expedir_representante", { _remessa: remessa });
  for (const m of [mCris, mDani, mFabi]) await ok(rep, "kit_transfer_confirm", { _transfer: (await transitoPara(m, rep.partyId!)).id, _payload: {} });
  mAna = await montarConferida(ana);
  // produção ligada, automático, todas as maletas (como hoje)
  await adm.unsafe(`update public.fiscal_settings set provider='focus', environment='producao', emission_active=true, producao_automatico=true, producao_todas=true`);
});
afterAll(async () => {
  await adm.unsafe(`update public.fiscal_settings set emission_active=$1, provider=$2, environment=$3, producao_piloto_cycle_id=$4, producao_todas=$5, producao_automatico=$6`,
    [original.emission_active, original.provider, original.environment, original.producao_piloto_cycle_id, original.producao_todas, original.producao_automatico]);
});

describe("0324: nota da troca de maleta sem ninguém marcar nada", () => {
  test("maleta que não saiu da empresa, nota de hoje: espera 10 min, cancela a nota antiga e pede a nova pela fila normal", async () => {
    const ref = await notaAutorizada(mAna, ana.partyId!);
    await ok(master, "remessa_maleta_transferir", { _cycle: mAna, _consultora: bia.partyId, _motivo: "troca de consultora teste" });
    const p = await pend(mAna);
    expect(p).toMatchObject({ status: "aberta", auto_status: "aguardando", nota_ref: ref });
    expect((await proximas()).some((x) => x.pendencia === p.id)).toBe(false); // ainda dentro dos 10 minutos
    await vencer(p.id);
    const plano = (await proximas()).find((x) => x.pendencia === p.id)!;
    expect(plano).toMatchObject({ acao: "cancelar", ref });
    // Focus/SEFAZ cancelou
    await adm.unsafe(`update public.fiscal_focus_envios set status='cancelado' where ref=$1`, [ref]);
    const depois = await pend(mAna);
    expect(depois).toMatchObject({ status: "resolvida", auto_status: "feito", auto_acao: "cancelar" });
    expect(depois.observacao ?? "").toMatch(/cancelada na SEFAZ/);
    expect((await fila(mAna))?.status).toBe("pendente");
  });

  test("maleta que já saiu: nota de devolução com as peças da nota antiga, em nome de quem estava nela", async () => {
    const ref = await notaAutorizada(mCris, cris.partyId!);
    await ok(master, "remessa_maleta_transferir", { _cycle: mCris, _consultora: eva.partyId, _motivo: "troca de consultora teste" });
    const p = await pend(mCris);
    await vencer(p.id);
    const plano = (await proximas()).find((x) => x.pendencia === p.id)!;
    expect(plano.acao).toBe("devolucao");
    expect(plano.origem?.chave).toHaveLength(44);
    expect(plano.itens).toEqual([
      expect.objectContaining({ quantidade: 2, preco_varejo_cents: 9990, numero_item_origem: 1 }),
      expect.objectContaining({ quantidade: 1, preco_varejo_cents: 4989, numero_item_origem: 2 }),
    ]);
    // não manda duas vezes enquanto a primeira está na SEFAZ
    const dev = `t324-${marca}-dev1`.slice(0, 40);
    const reg = await servico(`select public.fiscal_troca_registrar($1::uuid,$2,'{}'::jsonb) r`, [p.id, dev]);
    expect(reg.erro).toBeNull();
    expect((await servico(`select public.fiscal_troca_registrar($1::uuid,$2,'{}'::jsonb) r`, [p.id, `${dev}x`])).erro ?? "").toMatch(/já tem nota de devolução|já fechada/);
    const d = await um<{ operacao: string; party_id: string; ref_origem: string }>(`select operacao, party_id, ref_origem from public.fiscal_focus_envios where ref=$1`, [dev]);
    expect(d).toMatchObject({ operacao: "devolucao", party_id: cris.partyId, ref_origem: ref });
    // SEFAZ autorizou a devolução
    await adm.unsafe(`update public.fiscal_focus_envios set status='autorizado', numero='990', serie='3' where ref=$1`, [dev]);
    const o = await um<{ anulada_em: string | null; anulada_por_ref: string }>(`select anulada_em, anulada_por_ref from public.fiscal_focus_envios where ref=$1`, [ref]);
    expect(o.anulada_em).not.toBeNull();
    expect(o.anulada_por_ref).toBe(dev);
    expect(await pend(mCris)).toMatchObject({ status: "resolvida", auto_status: "feito", auto_acao: "devolucao" });
    expect((await fila(mCris))?.status).toBe("pendente");
    // a remessa nova da Eva pode ser registrada (a antiga não é mais a nota viva)
    const nova = await servico(`select public.fiscal_focus_envio_maleta_registrar($1,'producao',$2::uuid,$3::uuid,
        (select max(version) from public.kit_compositions where cycle_id=$2::uuid),'{}'::jsonb,$4::uuid,null) r`,
      [`t324-${marca}-nova`.slice(0, 40), mCris, eva.partyId, master.uid]);
    expect(nova.erro).toBeNull();
  });

  test("engano desfeito: a maleta voltou para quem está na nota, nada é emitido", async () => {
    const ref = await notaAutorizada(mDani, dani.partyId!);
    await ok(master, "remessa_maleta_transferir", { _cycle: mDani, _consultora: gabi.partyId, _motivo: "troca errada teste" });
    await ok(master, "remessa_maleta_transferir", { _cycle: mDani, _consultora: dani.partyId, _motivo: "voltando para a Dani" });
    const p = await pend(mDani);
    await vencer(p.id);
    expect((await proximas()).some((x) => x.pendencia === p.id)).toBe(false);
    const depois = await pend(mDani);
    expect(depois.status).toBe("resolvida");
    expect(depois.observacao ?? "").toMatch(/voltou para quem está na nota/);
    const n = await um<{ status: string; anulada_em: string | null }>(`select status, anulada_em from public.fiscal_focus_envios where ref=$1`, [ref]);
    expect(n).toEqual({ status: "autorizado", anulada_em: null });
  });

  test("recusa da SEFAZ: tenta de novo sozinho; resposta incerta (635) para e pede conferência", async () => {
    await notaAutorizada(mFabi, fabi.partyId!);
    await ok(rep, "maleta_devolucao_pedir", { _cycle: mFabi, _motivo: "Fabi não ficou com a maleta" });
    const dvl = await um<{ id: string }>(`select id from public.maleta_devolucoes where cycle_id=$1 and status='pedida'`, [mFabi]);
    await ok(montagem, "maleta_devolucao_receber", { _id: dvl.id });
    const p = await pend(mFabi);
    expect(p.status).toBe("aberta");
    await vencer(p.id);
    expect((await proximas()).find((x) => x.pendencia === p.id)?.acao).toBe("devolucao");
    const r1 = `t324-${marca}-r1`.slice(0, 40);
    await servico(`select public.fiscal_troca_registrar($1::uuid,$2,'{}'::jsonb) r`, [p.id, r1]);
    await adm.unsafe(`update public.fiscal_focus_envios set status='erro_autorizacao', status_sefaz='225', mensagem_sefaz='Falha no schema' where ref=$1`, [r1]);
    const a = await pend(mFabi);
    expect(a).toMatchObject({ status: "aberta", auto_status: "aguardando" });
    expect(a.auto_erro ?? "").toMatch(/SEFAZ recusou/);
    await vencer(p.id);
    expect((await proximas()).find((x) => x.pendencia === p.id)?.acao).toBe("devolucao");
    const r2 = `t324-${marca}-r2`.slice(0, 40);
    await servico(`select public.fiscal_troca_registrar($1::uuid,$2,'{}'::jsonb) r`, [p.id, r2]);
    await adm.unsafe(`update public.fiscal_focus_envios set status='erro_autorizacao', status_sefaz='635', mensagem_sefaz='NF-e com mesmo numero e serie ja transmitida' where ref=$1`, [r2]);
    const b = await pend(mFabi);
    expect(b.auto_status).toBe("erro");
    expect(b.auto_erro ?? "").toMatch(/^CONFERIR NA FOCUS/);
    await vencer(p.id);
    expect((await proximas()).some((x) => x.pendencia === p.id)).toBe(false); // nunca emite outra por cima
  });

  test("ninguém marca à mão e só o servidor mexe na fila das trocas", async () => {
    const p = await pend(mFabi);
    expect((await rpc(master, "maleta_troca_pendencia_resolver", { _id: p.id, _obs: "feito" })).erro ?? "").toMatch(/sai sozinha/);
    expect((await rpc(master, "fiscal_trocas_proximas", { _limite: 5 })).erro ?? "").not.toBe("");
    expect((await rpc(master, "fiscal_troca_concluir", { _pendencia: p.id, _obs: "x" })).erro ?? "").not.toBe("");
    expect((await rpc(master, "fiscal_troca_registrar", { _pendencia: p.id, _ref: "x", _payload: {} })).erro ?? "").not.toBe("");
    const lista = await ok<{ id: string; auto_status: string }[]>(master, "fiscal_trocas_lista", {});
    expect(lista.find((x) => x.id === p.id)?.auto_status).toBe("erro");
    expect((await rpc(ana, "fiscal_trocas_lista", {})).erro ?? "").toMatch(/permissão/);
  });

  test("nota de teste (homologação) não vira nota de devolução", async () => {
    const mH = await montarConferida(cris);
    await notaAutorizada(mH, cris.partyId!, "homologacao");
    await ok(master, "remessa_maleta_transferir", { _cycle: mH, _consultora: gabi.partyId, _motivo: "troca de teste homolog" });
    const p = await pend(mH);
    await vencer(p.id);
    expect((await proximas()).some((x) => x.pendencia === p.id)).toBe(false);
    expect((await pend(mH)).observacao ?? "").toMatch(/era de teste/);
  });
});
