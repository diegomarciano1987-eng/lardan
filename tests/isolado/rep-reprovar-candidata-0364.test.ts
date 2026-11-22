/**
 * 0364–0366 (Diego, 22/11/2026) — representante reprova candidata pelo app. Banco ISOLADO, dados sintéticos.
 *  - motivo obrigatório (mesmos motivos do CRM; "Outro" exige texto);
 *  - vai para "Reprovadas" no app (coluna nao_aprovada) e para "Perdidas" no CRM (outcome perdida), com histórico e auditoria;
 *  - quem já recebeu maleta não é reprovada; outro representante não mexe;
 *  - desfazer só a reprovação feita pelo representante; recusa da equipe da Lardan só a equipe reabre.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, ler, rpc, type Conta } from "./base";

let master: Conta, repC: Conta, outroRep: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
async function lead(rep: string, status = "novo", party: string | null = null) {
  return (await um<{ id: string }>(`insert into public.leads (full_name, whatsapp, city, uf, privacy_version, status, party_id, representante_party_id, representante_origem, stage_id)
      values ($1,'43999990001','Londrina','PR','v1',$2::lead_status,$3,$4,'link',(select id from public.candidatura_stages order by sort_order limit 1)) returning id`, [`ISO Reprov ${marca()}`, status, party, rep])).id;
}
const motivo = async (label: string) => (await um<{ id: string }>(`select id from public.candidatura_lost_reasons where label=$1`, [label])).id;
const card = async (rep: Conta, l: string) => {
  const r = await rpc<{ cards: { lead_id: string; sistema: string | null; reprovacao: { motivo: string; nota: string | null; pelo_representante: boolean } | null }[] }>(rep, "rep_crm", { _rep: rep.partyId });
  expect(r.erro).toBeNull();
  return r.dados.cards.find((c) => c.lead_id === l)!;
};

beforeAll(async () => {
  master = await criarConta({ nome: `rp-master-${marca()}`, papeis: ["master"], comParty: true });
  repC = await criarConta({ nome: `rp-rep-${marca()}`, papeis: ["representante"], comParty: true });
  outroRep = await criarConta({ nome: `rp-rep2-${marca()}`, papeis: ["representante"], comParty: true });
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'representante'),($2,'representante') on conflict do nothing`, [repC.partyId, outroRep.partyId]);
  await adm.unsafe(`insert into public.candidatura_lost_reasons (key, label, requires_note, sort_order) select 'outro','Outro',true,99 where not exists (select 1 from public.candidatura_lost_reasons where label='Outro')`);
  await adm.unsafe(`insert into public.candidatura_lost_reasons (key, label, sort_order) select 'sem_retorno','Sem retorno',10 where not exists (select 1 from public.candidatura_lost_reasons where label='Sem retorno')`);
});

describe("0364 — reprovar candidata pelo app do representante", () => {
  test("motivos do CRM disponíveis no app; 'Outro' vem por último", async () => {
    const r = await ler<{ label: string }>(repC, `select label from public.rep_lead_motivos()`);
    expect(r.linhas.map((x) => x.label)).toContain("Sem retorno");
    expect(r.linhas.at(-1)?.label).toBe("Outro");
  });

  test("reprova com motivo: Reprovadas no app, Perdidas no CRM, histórico e auditoria", async () => {
    const l = await lead(repC.partyId!);
    const r = await rpc(repC, "rep_lead_reprovar", { _rep: repC.partyId, _lead: l, _motivo: await motivo("Sem retorno"), _nota: "não responde há 10 dias" });
    expect(r.erro).toBeNull();
    const le = await um<Record<string, unknown>>(`select status::text, outcome, lost_notes, representante_party_id from public.leads where id=$1`, [l]);
    expect(le).toEqual({ status: "recusado", outcome: "perdida", lost_notes: "não responde há 10 dias", representante_party_id: repC.partyId });
    const c = await card(repC, l);
    expect(c.sistema).toBe("nao_aprovada");
    expect(c.reprovacao).toMatchObject({ motivo: "Sem retorno", nota: "não responde há 10 dias", pelo_representante: true });
    // CRM da Lardan: "Perdidas" = outcome perdida (filtro desfecho do crm_filtrar), já conferido acima
    expect((await um<{ n: number }>(`select count(*)::int n from public.lead_events where lead_id=$1 and event_type='perda'`, [l])).n).toBe(1);
    expect((await um<{ n: number }>(`select count(*)::int n from public.audit_logs where entity='leads' and entity_id=$1 and action='candidatura.reprovada_representante'`, [l])).n).toBe(1);
    // clique duplo não duplica
    const de_novo = await rpc<{ ja_estava: boolean }>(repC, "rep_lead_reprovar", { _rep: repC.partyId, _lead: l, _motivo: await motivo("Sem retorno"), _nota: null });
    expect(de_novo.dados.ja_estava).toBe(true);
    expect((await um<{ n: number }>(`select count(*)::int n from public.lead_events where lead_id=$1 and event_type='perda'`, [l])).n).toBe(1);
  });

  test("sem motivo, 'Outro' sem texto, outro representante e quem já tem maleta: recusa", async () => {
    const l = await lead(repC.partyId!);
    expect((await rpc(repC, "rep_lead_reprovar", { _rep: repC.partyId, _lead: l, _motivo: null, _nota: null })).erro).toContain("motivo");
    expect((await rpc(repC, "rep_lead_reprovar", { _rep: repC.partyId, _lead: l, _motivo: await motivo("Outro"), _nota: "" })).erro).toContain("Escreva");
    expect((await rpc(outroRep, "rep_lead_reprovar", { _rep: outroRep.partyId, _lead: l, _motivo: await motivo("Sem retorno"), _nota: null })).erro).toContain("não está com você");
    expect((await rpc(outroRep, "rep_lead_reprovar", { _rep: repC.partyId, _lead: l, _motivo: await motivo("Sem retorno"), _nota: null })).erro).toContain("Sem acesso");
    expect((await um<{ s: string }>(`select status::text s from public.leads where id=$1`, [l])).s).toBe("novo");
  });

  test("desfazer: volta como estava; recusa feita pela Lardan só a equipe reabre", async () => {
    const l = await lead(repC.partyId!, "em_analise");
    await rpc(repC, "rep_lead_reprovar", { _rep: repC.partyId, _lead: l, _motivo: await motivo("Sem retorno"), _nota: null });
    const d = await rpc(repC, "rep_lead_reabrir", { _rep: repC.partyId, _lead: l });
    expect(d.erro).toBeNull();
    expect(await um(`select status::text, outcome, lost_reason_id from public.leads where id=$1`, [l])).toEqual({ status: "em_analise", outcome: "aberta", lost_reason_id: null });
    expect((await card(repC, l)).sistema).toBeNull();
    // recusa pela equipe (CRM)
    const l2 = await lead(repC.partyId!);
    expect((await rpc(master, "crm_mark_lost", { _lead: l2, _reason: await motivo("Sem retorno"), _nota: null })).erro).toBeNull();
    expect((await card(repC, l2)).reprovacao?.pelo_representante).toBe(false);
    expect((await rpc(repC, "rep_lead_reabrir", { _rep: repC.partyId, _lead: l2 })).erro).toContain("equipe da Lardan");
    // reprovação antiga do rep (segundos antes) não libera reabrir depois de nova recusa da equipe
    const l3 = await lead(repC.partyId!);
    await rpc(repC, "rep_lead_reprovar", { _rep: repC.partyId, _lead: l3, _motivo: await motivo("Sem retorno"), _nota: null });
    await rpc(repC, "rep_lead_reabrir", { _rep: repC.partyId, _lead: l3 });
    expect((await rpc(master, "crm_mark_lost", { _lead: l3, _reason: await motivo("Sem retorno"), _nota: null })).erro).toBeNull();
    expect((await rpc(repC, "rep_lead_reabrir", { _rep: repC.partyId, _lead: l3 })).erro).toContain("equipe da Lardan");
  });
});
