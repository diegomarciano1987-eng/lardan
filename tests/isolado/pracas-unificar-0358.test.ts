/**
 * 0358 (Diego, 20/11/2026) — banco ISOLADO, dados sintéticos.
 * Unificar a praça A na praça B e passar a carteira do representante "de" para o "para":
 *  - prévia não muda nada; só o executor interno roda (nem Master pelo navegador);
 *  - aplicar: consultoras da praça A vão para B; consultoras do "de" vão para o "para" (colaboradora fica);
 *    remessas e maletas abertas mudam de representante; maleta cancelada, status e notas não mudam; praça A desativada;
 *  - depois disso nenhum caminho grava a praça A de novo (cadastro, remessa, cidade da candidata);
 *  - desfazer pelo lote devolve tudo, menos o que alguém mudou depois.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const codA = 81000 + Math.floor(Math.random() * 8000);
const codB = codA + 1;
const numA = 90000 + Math.floor(Math.random() * 8000);
const numB = numA + 1;
const cidadeA = `CIDADEA${marca}`.toUpperCase();
let master: Conta, repDe: Conta, repPara: Conta, cA: Conta, cB1: Conta, cB2: Conta, colab: Conta;
let pracaA = "", pracaB = "", remA = "", remB = "", kitAberto = "", kitCancelado = "", lote = "";

const perfil = (p: string) => um<{ praca_id: string; representative_party_id: string }>(
  `select praca_id, representative_party_id from public.consultant_profiles where party_id=$1`, [p]);
const remessa = (id: string) => um<{ praca_id: string; representante_party_id: string }>(
  `select praca_id, representante_party_id from public.remessas where id=$1`, [id]);
const kit = (id: string) => um<{ representante_party_id: string; status: string }>(
  `select representante_party_id, status::text from public.kit_cycles where id=$1`, [id]);
const args = (aplicar: boolean) => ({ _origem_codigo: codA, _destino_codigo: codB, _rep_de: repDe.partyId, _rep_para: repPara.partyId,
  _remessas: [numA, numB], _motivo: "teste isolado", _aplicar: aplicar });

async function ciclo(party: string, status: string, rem: string, rep: string) {
  const k = (await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO UNIF ${marca}-${Math.random()}`])).id;
  return (await um<{ id: string }>(
    `insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id, status, remessa_id, representante_party_id) values ($1,1,$2,$3::public.kit_status,$4,$5) returning id`,
    [k, party, status, rem, rep])).id;
}

beforeAll(async () => {
  master = await criarConta({ nome: `unif-master-${marca}`, papeis: ["master"], comParty: true });
  repDe = await criarConta({ nome: `unif-de-${marca}`, papeis: ["representante"], comParty: true });
  repPara = await criarConta({ nome: `unif-para-${marca}`, papeis: ["representante"], comParty: true });
  for (const r of [repDe, repPara]) await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'representante') on conflict do nothing`, [r.partyId]);
  [cA, cB1, cB2, colab] = await Promise.all(["a", "b1", "b2", "colab"].map((n) =>
    criarConta({ nome: `unif-${n}-${marca}`, papeis: ["consultora"], comParty: true })));
  pracaA = (await um<{ id: string }>(`insert into public.cob_pracas (codigo, nome) values ($1,$2) returning id`, [codA, `UNIF A ${marca}`])).id;
  pracaB = (await um<{ id: string }>(`insert into public.cob_pracas (codigo, nome) values ($1,$2) returning id`, [codB, `UNIF B ${marca}`])).id;
  await adm.unsafe(`insert into public.legado_pracas (codigo, nome, cidades, praca_id) values ($1,$2,$3,$4),($5,$6,$7,$8)`,
    [codA, `UNIF A ${marca}`, `${cidadeA}/PR`, pracaA, codB, `UNIF B ${marca}`, `CIDADEB${marca}/PR`.toUpperCase(), pracaB]);
  await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3),($4,$5,$6),($7,$5,$6),($8,$5,$6)`,
    [cA.partyId, repPara.partyId, pracaA, cB1.partyId, repDe.partyId, pracaB, cB2.partyId, colab.partyId]);
  await adm.unsafe(`insert into public.colab_acessos (user_id, party_id, codigo) values ($1,$2,$3)`, [colab.uid, colab.partyId, String(numA).slice(-6)]);
  remA = (await um<{ id: string }>(`insert into public.remessas (numero, praca_id, representante_party_id, data_acerto) values ($1,$2,$3,current_date+30) returning id`, [numA, pracaA, repPara.partyId])).id;
  remB = (await um<{ id: string }>(`insert into public.remessas (numero, praca_id, representante_party_id, data_acerto) values ($1,$2,$3,current_date+30) returning id`, [numB, pracaB, repDe.partyId])).id;
  kitAberto = await ciclo(cB1.partyId, "conferida", remB, repDe.partyId!);
  kitCancelado = await ciclo(cB2.partyId, "cancelada", remB, repDe.partyId!);
});

describe("0358 — unificar praça e transferir carteira", () => {
  test("prévia mostra os números e não muda nada", async () => {
    const r = await rpcServico<Record<string, unknown>>("pracas_unificar_transferir", args(false));
    expect(r.erro).toBeNull();
    expect(r.dados.previa).toBe(true);
    expect(r.dados.consultoras_mudam_praca).toBe(1);
    expect(r.dados.consultoras_mudam_representante).toBe(2);
    expect(r.dados.remessas_mudam_praca).toBe(1);
    expect(r.dados.remessas_mudam_representante).toBe(1);
    expect(r.dados.maletas_mudam_representante).toBe(1);
    expect((await perfil(cA.partyId!)).praca_id).toBe(pracaA);
    expect((await remessa(remB)).representante_party_id).toBe(repDe.partyId!);
  });

  test("ninguém pelo navegador executa, nem Master", async () => {
    const r = await rpc(master, "pracas_unificar_transferir", args(true));
    expect(r.ok).toBe(false);
    expect((await perfil(cA.partyId!)).praca_id).toBe(pracaA);
  });

  test("aplicar muda praça, carteira, remessas e maletas abertas; preserva colaboradora, cancelada e status", async () => {
    const filaAntes = (await um<{ n: number }>(`select count(*)::int n from public.fiscal_fila where cycle_id=$1`, [kitAberto])).n;
    const r = await rpcServico<Record<string, unknown>>("pracas_unificar_transferir", args(true));
    expect(r.erro).toBeNull();
    lote = r.dados.lote as string;
    expect(lote).toBeTruthy();
    expect((await perfil(cA.partyId!)).praca_id).toBe(pracaB);
    expect((await perfil(cA.partyId!)).representative_party_id).toBe(repPara.partyId!);
    expect((await perfil(cB1.partyId!)).representative_party_id).toBe(repPara.partyId!);
    expect((await perfil(cB2.partyId!)).representative_party_id).toBe(repPara.partyId!);
    expect((await perfil(colab.partyId!)).representative_party_id).toBe(repDe.partyId!);
    expect((await remessa(remA)).praca_id).toBe(pracaB);
    expect((await remessa(remB)).representante_party_id).toBe(repPara.partyId!);
    expect(await kit(kitAberto)).toEqual({ representante_party_id: repPara.partyId!, status: "conferida" });
    expect((await kit(kitCancelado)).representante_party_id).toBe(repDe.partyId!);
    expect((await um<{ ativo: boolean }>(`select ativo from public.cob_pracas where id=$1`, [pracaA])).ativo).toBe(false);
    expect((await um<{ n: number }>(`select count(*)::int n from public.fiscal_fila where cycle_id=$1`, [kitAberto])).n).toBe(filaAntes);
  });

  test("aplicar de novo é recusado", async () => {
    const r = await rpcServico("pracas_unificar_transferir", args(true));
    expect(r.erro).toContain("já foi unificada");
  });

  test("a praça unificada não volta: cadastro, remessa e cidade da candidata caem na praça nova", async () => {
    const nova = await criarConta({ nome: `unif-nova-${marca}`, papeis: ["consultora"], comParty: true });
    // a colaboradora (ainda do outro representante) sai da praça, para a praça ter um único representante ativo
    await adm.unsafe(`update public.consultant_profiles set praca_id=null where party_id=$1`, [colab.partyId]);
    await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2)`, [nova.partyId, pracaA]);
    const p = await perfil(nova.partyId!);
    expect(p.praca_id).toBe(pracaB);
    expect(p.representative_party_id).toBe(repPara.partyId!); // único representante ativo da praça
    await adm.unsafe(`update public.remessas set praca_id=$2 where id=$1`, [remA, pracaA]);
    expect((await remessa(remA)).praca_id).toBe(pracaB);
    const c = await um<{ p: string }>(`select public.praca_pela_cidade($1,'PR') p`, [cidadeA.toLowerCase()]);
    expect(c.p).toBe(pracaB);
  });

  test("desfazer devolve tudo, menos o que mudou depois", async () => {
    await adm.unsafe(`update public.consultant_profiles set representative_party_id=$2 where party_id=$1`, [cB2.partyId, master.partyId]);
    const r = await rpcServico<Record<string, number>>("pracas_unificar_desfazer", { _lote: lote, _motivo: "teste isolado" });
    expect(r.erro).toBeNull();
    expect(r.dados.mantidos_por_mudanca_posterior).toBe(1);
    expect((await perfil(cA.partyId!)).praca_id).toBe(pracaA);
    expect((await perfil(cB1.partyId!)).representative_party_id).toBe(repDe.partyId!);
    expect((await perfil(cB2.partyId!)).representative_party_id).toBe(master.partyId!);
    expect((await remessa(remA)).praca_id).toBe(pracaA);
    expect((await remessa(remB)).representante_party_id).toBe(repDe.partyId!);
    expect((await kit(kitAberto)).representante_party_id).toBe(repDe.partyId!);
    expect((await um<{ ativo: boolean }>(`select ativo from public.cob_pracas where id=$1`, [pracaA])).ativo).toBe(true);
    const c = await um<{ p: string }>(`select public.praca_pela_cidade($1,'PR') p`, [cidadeA.toLowerCase()]);
    expect(c.p).toBe(pracaA);
    const de2 = await rpcServico("pracas_unificar_desfazer", { _lote: lote, _motivo: "de novo" });
    expect(de2.erro).toContain("já desfeito");
  });
});
