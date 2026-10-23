/**
 * 0129 — consultora antiga com o número do SmallData como código do cadastro. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 800000 + Math.floor(Math.random() * 90000);
let master: Conta, carla: Conta, dupla: Conta, rep: Conta, outra: Conta;
let codeCarla = "";

const ligar = (party: string, codcli: number) =>
  adm.unsafe(`insert into public.party_codigos_legados (party_id, sistema, codigo) values ($1,'cliente',$2)`, [party, String(codcli)]);
const codigo = async (party: string) => (await um<{ c: string }>(`select code c from public.parties where id=$1`, [party])).c;

beforeAll(async () => {
  master = await criarConta({ nome: `cod-master-${base}`, papeis: ["master"], comParty: true });
  carla = await criarConta({ nome: `cod-carla-${base}`, papeis: ["consultora"], comParty: true });
  dupla = await criarConta({ nome: `cod-dupla-${base}`, papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: `cod-rep-${base}`, papeis: ["representante"], comParty: true });
  outra = await criarConta({ nome: `cod-outra-${base}`, papeis: ["consultora"], comParty: true });
  codeCarla = await codigo(carla.partyId!);
  await ligar(carla.partyId!, base + 1);
  await ligar(dupla.partyId!, base + 2);
  await ligar(dupla.partyId!, base + 3);
  await ligar(rep.partyId!, base + 4);
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'representante')`, [rep.partyId]);
});

describe("código do SmallData no cadastro", () => {
  test("prévia não troca nada e mostra quem tem mais de um código e o representante", async () => {
    const r = await rpc<{ aplicado: boolean; mais_de_um_codigo: { nome: string }[]; representantes_mantidos: { nome: string }[] }>(
      master, "party_codigos_smalldata_adotar", {});
    expect(r.erro).toBeNull();
    expect(r.dados.aplicado).toBe(false);
    expect(r.dados.mais_de_um_codigo.some((x) => x.nome.includes(`cod-dupla-${base}`))).toBe(true);
    expect(r.dados.representantes_mantidos.some((x) => x.nome.includes(`cod-rep-${base}`))).toBe(true);
    expect(await codigo(carla.partyId!)).toBe(codeCarla);
  });

  test("Carla: passa a ter o número do SmallData; o código antigo fica no histórico e ainda acha o cadastro", async () => {
    const r = await rpc<{ antes: string; code: string }>(master, "party_codigo_smalldata_adotar", { _party: carla.partyId });
    expect(r.erro).toBeNull();
    expect(r.dados).toEqual({ party_id: carla.partyId, antes: codeCarla, code: String(base + 1) });
    expect(await codigo(carla.partyId!)).toBe(String(base + 1));
    const busca = await rpc<{ id: string }[]>(master, "search_registry", { _term: codeCarla, _limit: 10 });
    expect(busca.erro).toBeNull();
    expect(JSON.stringify(busca.dados)).toContain(carla.partyId!);
    // de novo: nada muda
    expect((await rpc<{ repetido: boolean }>(master, "party_codigo_smalldata_adotar", { _party: carla.partyId })).dados.repetido).toBe(true);
  });

  test("mais de um código: só com a escolha do Master; código de fora é recusado", async () => {
    expect((await rpc(master, "party_codigo_smalldata_adotar", { _party: dupla.partyId })).erro).toContain("mais de um código");
    expect((await rpc(master, "party_codigo_smalldata_adotar", { _party: dupla.partyId, _codigo: String(base + 9) })).erro).toContain("não é deste cadastro");
    expect((await rpc(master, "party_codigo_smalldata_adotar", { _party: dupla.partyId, _codigo: String(base + 3) })).erro).toBeNull();
    expect(await codigo(dupla.partyId!)).toBe(String(base + 3));
  });

  test("representante mantém o código; código de outro cadastro é recusado; só o Master troca", async () => {
    expect((await rpc(master, "party_codigo_smalldata_adotar", { _party: rep.partyId })).erro).toContain("Representante");
    // alguém já digitou esse número como código de outro cadastro
    await adm.unsafe(`update public.parties set code=$2 where id=$1`, [rep.partyId, String(base + 6)]);
    await ligar(outra.partyId!, base + 6);
    expect((await rpc(master, "party_codigo_smalldata_adotar", { _party: outra.partyId })).erro).toContain("já é de outro cadastro");
    expect((await rpc(carla, "party_codigo_smalldata_adotar", { _party: carla.partyId })).ok).toBe(false);
    expect((await rpc(carla, "party_codigos_smalldata_adotar", {})).ok).toBe(false);
  });

  test("lote aplica só onde não há dúvida", async () => {
    const solo = await criarConta({ nome: `cod-solo-${base}`, papeis: ["consultora"], comParty: true });
    await ligar(solo.partyId!, base + 5);
    const r = await rpc<{ trocados: number; falhas: unknown[] }>(master, "party_codigos_smalldata_adotar", { _aplicar: true });
    expect(r.erro).toBeNull();
    expect(r.dados.falhas).toEqual([]);
    expect(await codigo(solo.partyId!)).toBe(String(base + 5));
    expect(await codigo(rep.partyId!)).not.toBe(String(base + 4));
    const h = await um<{ n: number }>(`select count(*)::int n from public.party_codigo_historico where party_id=$1`, [solo.partyId]);
    expect(h.n).toBe(1);
  });
});
