/**
 * 0332/0334 (Diego 17/11) — banco ISOLADO, dados sintéticos.
 *  1. Promissória assinada no papel: o representante da carteira registra (uma vez só), outro representante e a
 *     consultora não; desfazer exige motivo; a abertura passa a contar como concluída.
 *  2. Aberturas aguardando assinatura vêm do servidor: pendente aparece, concluída vai para o histórico.
 *  3. 2ª maleta: o app sabe que ela já tem maleta na remessa.
 *  4. Ficha completa da candidata: só o representante dela (ou a equipe de candidaturas).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let rep: Conta, repOutro: Conta, cons: Conta, consNova: Conta;
let cicloNova = "", cicloA = "", cicloB = "", remessa = "", leadId = "";

async function ciclo(party: string, status: string, rem: string | null, motivo: string | null = null) {
  const kit = (await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO PAPEL ${marca}-${Math.random()}`])).id;
  return (await um<{ id: string }>(
    `insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id, status, remessa_id, segunda_maleta_motivo) values ($1,1,$2,$3::public.kit_status,$4,$5) returning id`,
    [kit, party, status, rem, motivo])).id;
}

beforeAll(async () => {
  rep = await criarConta({ nome: `papel-rep-${marca}`, papeis: ["representante"], comParty: true });
  repOutro = await criarConta({ nome: `papel-rep2-${marca}`, papeis: ["representante"], comParty: true });
  cons = await criarConta({ nome: `papel-cons-${marca}`, papeis: ["consultora"], comParty: true });
  consNova = await criarConta({ nome: `papel-nova-${marca}`, papeis: ["consultora"], comParty: true });
  for (const c of [cons, consNova])
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, joined_at) values ($1,$2,current_date)
                      on conflict (party_id) do update set representative_party_id = excluded.representative_party_id, joined_at = current_date`, [c.partyId, rep.partyId]);
  const praca = (await um<{ id: string }>(`insert into public.cob_pracas (codigo, nome) values ($1,$2) returning id`, [80000 + Math.floor(Math.random() * 9999), `PAPEL ${marca}`])).id;
  remessa = (await um<{ id: string }>(`insert into public.remessas (numero, praca_id, representante_party_id) values ($1,$2,$3) returning id`,
    [90000 + Math.floor(Math.random() * 9000), praca, rep.partyId])).id;
  cicloNova = await ciclo(consNova.partyId!, "transito", remessa);
  cicloA = await ciclo(cons.partyId!, "operacao", remessa);
  cicloB = await ciclo(cons.partyId!, "transito", remessa, "segunda maleta teste");
  leadId = (await um<{ id: string }>(
    `insert into public.leads (full_name, whatsapp, city, uf, privacy_version, stage_id, representante_party_id, party_id, street, street_number, postal_code, dream, motivation)
     values ($1,'43999990000','Ibaiti','PR','v1',(select id from public.candidatura_stages order by sort_order limit 1),$2,$3,'Rua das Flores','123','84900-000','Casa própria','Renda extra') returning id`,
    [`Nova Papel ${marca}`, rep.partyId, consNova.partyId])).id;
});

describe("promissória assinada no papel", () => {
  let papelId = "";
  test("consultora e outro representante não registram", async () => {
    expect((await rpc(cons, "promissoria_papel_registrar", { _rep: rep.partyId, _cycle: cicloNova })).erro).not.toBeNull();
    expect((await rpc(repOutro, "promissoria_papel_registrar", { _rep: repOutro.partyId, _cycle: cicloNova })).erro).not.toBeNull();
    expect((await rpc(repOutro, "promissoria_papel_registrar", { _rep: rep.partyId, _cycle: cicloNova })).erro).not.toBeNull();
  });
  test("o representante dela registra, uma vez só (clique duplo não duplica)", async () => {
    const r1 = await rpc<{ id: string; repetida: boolean }>(rep, "promissoria_papel_registrar", { _rep: rep.partyId, _cycle: cicloNova });
    expect(r1.erro).toBeNull();
    expect(r1.dados.repetida).toBe(false);
    papelId = r1.dados.id;
    const r2 = await rpc<{ id: string; repetida: boolean }>(rep, "promissoria_papel_registrar", { _rep: rep.partyId, _cycle: cicloNova });
    expect(r2.dados).toMatchObject({ id: papelId, repetida: true });
    const n = await um<{ n: number }>(`select count(*)::int n from public.promissorias_papel where cycle_id = $1 and cancelada_em is null`, [cicloNova]);
    expect(n.n).toBe(1);
    const aud = await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action = 'promissoria.papel_registrada' and entity_id = $1`, [cicloNova]);
    expect(aud.n).toBe(1);
  });
  test("a lista de assinaturas mostra o papel e a consultora não lê a tabela direto", async () => {
    const r = await rpc<{ papel: { cycle_id: string }[] }>(rep, "assinaturas_da_consultora", { _party: consNova.partyId, _rep: rep.partyId });
    expect(r.erro).toBeNull();
    expect(r.dados.papel.map((p) => p.cycle_id)).toContain(cicloNova);
    const direto = await rpc(cons, "assinaturas_da_consultora", { _party: consNova.partyId, _rep: rep.partyId });
    expect(direto.erro).not.toBeNull();
  });
  test("aberturas: sem contrato fica pendente; com contrato + papel vai para concluídas", async () => {
    let r = await rpc<{ pendentes: { party_id: string; promissoria_papel: boolean }[]; concluidas: { party_id: string }[] }>(rep, "rep_aberturas_assinatura", { _rep: rep.partyId });
    expect(r.erro).toBeNull();
    expect(r.dados.pendentes.find((x) => x.party_id === consNova.partyId)?.promissoria_papel).toBe(true);
    await adm.unsafe(`insert into public.assinaturas_digitais (party_id, tipo, status, titulo, assinado_em, ambiente, doc_token, representante_party_id, texto_hash)
                      values ($1,'contrato','assinado','Contrato',now(),'sandbox',$2,$3,'h')`, [consNova.partyId, `tok-${marca}`, rep.partyId]);
    r = await rpc(rep, "rep_aberturas_assinatura", { _rep: rep.partyId });
    expect(r.dados.pendentes.some((x) => x.party_id === consNova.partyId)).toBe(false);
    expect(r.dados.concluidas.some((x) => x.party_id === consNova.partyId)).toBe(true);
    expect((await rpc(repOutro, "rep_aberturas_assinatura", { _rep: rep.partyId })).erro).not.toBeNull();
  });
  test("desfazer exige motivo e libera novo registro", async () => {
    expect((await rpc(rep, "promissoria_papel_cancelar", { _rep: rep.partyId, _id: papelId, _motivo: "ok" })).erro).not.toBeNull();
    expect((await rpc(rep, "promissoria_papel_cancelar", { _rep: rep.partyId, _id: papelId, _motivo: "folha errada" })).erro).toBeNull();
    const r = await rpc<{ repetida: boolean }>(rep, "promissoria_papel_registrar", { _rep: rep.partyId, _cycle: cicloNova });
    expect(r.dados.repetida).toBe(false);
  });
});

describe("2ª maleta e ficha da candidata", () => {
  test("o app sabe que ela já tem maleta nesta remessa", async () => {
    const r = await rpc<{ maleta: string | null }>(rep, "rep_maleta_ja_tem", { _rep: rep.partyId, _cycle: cicloB, _consultora: cons.partyId });
    expect(r.erro).toBeNull();
    expect(r.dados.maleta).not.toBeNull();
    const n = await rpc<{ maleta: string | null }>(rep, "rep_maleta_ja_tem", { _rep: rep.partyId, _cycle: cicloB, _consultora: consNova.partyId });
    expect(n.dados.maleta).not.toBeNull(); // consNova tem a cicloNova na mesma remessa
    void cicloA;
  });
  test("ficha completa: endereço e respostas para o representante dela; outro representante não vê", async () => {
    const r = await rpc<{ rua: string; numero: string; respostas: Record<string, string | null> }>(rep, "rep_candidata_ficha", { _lead: leadId });
    expect(r.erro).toBeNull();
    expect(r.dados.rua).toBe("Rua das Flores");
    expect(r.dados.numero).toBe("123");
    expect(r.dados.respostas["Sonho"]).toBe("Casa própria");
    expect((await rpc(repOutro, "rep_candidata_ficha", { _lead: leadId })).erro).not.toBeNull();
    expect((await rpc(cons, "rep_candidata_ficha", { _lead: leadId })).erro).not.toBeNull();
  });
});
