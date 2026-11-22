/**
 * 0362 (Diego, 22/11/2026) — aba "Maletas individuais" em Remessas. Banco ISOLADO, dados sintéticos.
 *  - maleta direta (sem representante, só responsável) sai da lista normal de remessas;
 *  - aparece na aba própria, com buscador por maleta, consultora (nome/código), responsável e nº da remessa;
 *  - remessa de praça continua na lista normal e não aparece na aba.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, ler, rpc, type Conta } from "./base";

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const dia = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let master: Conta, resp: Conta, rep: Conta, cons: Conta, estoque: Conta;
let deposito = "", praca = "", direta = { cycle: "", remessa: "", numero: 0 }, normal = "";

beforeAll(async () => {
  master = await criarConta({ nome: `mi-master-${marca}`, papeis: ["master"], comParty: true });
  resp = await criarConta({ nome: `mi-resp-${marca} Responsavel`, papeis: ["estoque"], comParty: true });
  rep = await criarConta({ nome: `mi-rep-${marca}`, papeis: ["representante"], comParty: true });
  cons = await criarConta({ nome: `mi-cons-${marca} Graziela`, papeis: ["consultora"], comParty: true });
  estoque = await criarConta({ nome: `mi-est-${marca}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`mi-${marca}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça MI ${marca}`])).linhas[0]!.id;
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [cons.partyId]);
  await adm.unsafe(`update public.parties set status='ativo', code=$2 where id=$1`, [cons.partyId, `MI${marca}`.slice(0, 12)]);
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id=excluded.praca_id`, [cons.partyId, praca]);
  const r = await rpc<{ cycle_id: string; remessa_id: string; remessa_numero: number }>(master, "maleta_direta_abrir", {
    _consultora: cons.partyId, _data_acerto: dia(30), _responsavel: resp.uid, _deposito: deposito });
  if (r.erro) throw new Error(r.erro);
  direta = { cycle: r.dados.cycle_id, remessa: r.dados.remessa_id, numero: r.dados.remessa_numero };
  const n = await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _numero: null, _representante: rep.partyId, _data_acerto: dia(40), _observacoes: null, _deposito: deposito, _origem: null });
  if (n.erro) throw new Error(n.erro);
  normal = (n.dados as unknown as { id: string }).id;
});

describe("0362 — Maletas individuais", () => {
  test("a lista normal de remessas não mostra a maleta direta; a remessa de praça continua", async () => {
    const l = await ler<{ id: string }>(master, `select id from public.remessas_buscar2(null,null,$1,null,null,null,'emissao',false)`, [praca]);
    const ids = l.linhas.map((x) => x.id);
    expect(ids).toContain(normal);
    expect(ids).not.toContain(direta.remessa);
    const d = await ler<{ id: string }>(master, `select id from public.remessas_buscar2(null,null,$1,null,null,null,'emissao',true)`, [praca]);
    expect(d.linhas.map((x) => x.id)).toEqual([direta.remessa]);
  });

  test("a aba lista a maleta direta com responsável, e a busca acha por maleta, consultora, código e responsável", async () => {
    const tudo = await ler<{ cycle_id: string; responsavel: string; remessa_id: string }>(master, `select cycle_id, responsavel, remessa_id from public.maletas_individuais_buscar(null,'abertas')`);
    const minha = tudo.linhas.find((x) => x.cycle_id === direta.cycle);
    expect(minha?.responsavel).toContain(`mi-resp-${marca}`);
    expect(tudo.linhas.some((x) => x.remessa_id === normal)).toBe(false);
    const kit = (await adm.unsafe(`select k.code from public.kit_cycles c join public.kits k on k.id=c.kit_id where c.id=$1`, [direta.cycle]) as { code: string }[])[0]!.code;
    for (const termo of [kit, `mi-cons-${marca}`, "Graziela", `MI${marca}`.slice(0, 12), `Responsavel`, String(direta.numero)]) {
      const r = await ler<{ cycle_id: string }>(master, `select cycle_id from public.maletas_individuais_buscar($1,'todas')`, [termo]);
      expect(r.linhas.map((x) => x.cycle_id)).toContain(direta.cycle);
    }
    const nada = await ler<{ cycle_id: string }>(master, `select cycle_id from public.maletas_individuais_buscar($1,'todas')`, [`zz-nao-existe-${marca}`]);
    expect(nada.linhas).toEqual([]);
  });

  test("0363: busca tolerante a erro de digitação no nome (Graziela → Grazziela, Responsavel → Responsaval)", async () => {
    for (const termo of ["Grazziela", "Responsaval"]) {
      const r = await ler<{ cycle_id: string }>(master, `select cycle_id from public.maletas_individuais_buscar($1,'todas')`, [termo]);
      expect(r.linhas.map((x) => x.cycle_id)).toContain(direta.cycle);
    }
  });

  test("consultora não enxerga a aba (mesmo acesso das remessas)", async () => {
    const r = await ler<{ cycle_id: string }>(estoque, `select cycle_id from public.maletas_individuais_buscar(null,'todas')`);
    expect(r.linhas.some((x) => x.cycle_id === direta.cycle)).toBe(false);
  });
});
