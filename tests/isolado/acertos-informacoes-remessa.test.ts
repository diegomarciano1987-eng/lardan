/**
 * 0246 — informações da remessa, acertos do representante e checklist digital. Banco ISOLADO.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let montagem: Conta, repC: Conta, outroRep: Conta, consultora: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
let remessa: string, praca: string, comMaleta: string, semMaleta: string, ciclo: string;

beforeAll(async () => {
  montagem = await criarConta({ nome: `ac-mont-${marca()}`, papeis: ["montagem"], comParty: true });
  repC = await criarConta({ nome: `ac-rep-${marca()}`, papeis: ["representante"], comParty: true });
  outroRep = await criarConta({ nome: `ac-rep2-${marca()}`, papeis: ["representante"], comParty: true });
  consultora = await criarConta({ nome: `ac-cons-${marca()}`, papeis: ["consultora"], comParty: true });
  praca = (await um<{ id: string }>(`insert into public.cob_pracas (codigo, nome) values ($1,$2) returning id`, [900000 + Math.floor(Math.random() * 99999), `ISO praça ${marca()}`])).id;
  remessa = (await um<{ id: string }>(`insert into public.remessas (numero, praca_id, representante_party_id, data_emissao, data_acerto, status)
      values ((select coalesce(max(numero),0)+1 from public.remessas), $1, $2, current_date, current_date + 42, 'montagem') returning id`, [praca, repC.partyId])).id;
  const p = async (nome: string) => (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [nome])).id;
  comMaleta = await p(`ISO Com ${marca()}`); semMaleta = await p(`ISO Sem ${marca()}`);
  for (const x of [comMaleta, semMaleta]) {
    await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [x]);
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                      on conflict (party_id) do update set representative_party_id = excluded.representative_party_id, praca_id = excluded.praca_id`, [x, repC.partyId, praca]);
  }
  const kit = await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO AC ${marca()}`]);
  ciclo = (await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, status, consultora_party_id, representante_party_id, remessa_id, received_at)
      values ($1,1,'operacao',$2,$3,$4, now() - interval '40 days') returning id`, [kit.id, comMaleta, repC.partyId, remessa])).id;
});

describe("1. informações da remessa (Lardan)", () => {
  test("lista toda a praça; com maleta anota o acerto; sem maleta exige motivo válido", async () => {
    const l = await rpc<{ party_id: string; tem_maleta: boolean }[]>(montagem, "remessa_informacoes_lista", { _remessa: remessa });
    expect(l.erro).toBeNull();
    expect(l.dados.find((x) => x.party_id === comMaleta)?.tem_maleta).toBe(true);
    expect(l.dados.find((x) => x.party_id === semMaleta)?.tem_maleta).toBe(false);
    expect((await rpc(montagem, "remessa_informacao_salvar", { _remessa: remessa, _party: comMaleta, _motivo: null, _info: "Cobrar parcela de outubro no acerto" })).erro).toBeNull();
    expect((await rpc(montagem, "remessa_informacao_salvar", { _remessa: remessa, _party: semMaleta, _motivo: "outro", _info: "" })).erro).toContain("Outro");
    expect((await rpc(montagem, "remessa_informacao_salvar", { _remessa: remessa, _party: semMaleta, _motivo: "xyz", _info: "x" })).erro).toContain("Motivo inválido");
    expect((await rpc(montagem, "remessa_informacao_salvar", { _remessa: remessa, _party: semMaleta, _motivo: "inadimplente", _info: "Só volta quando quitar" })).erro).toBeNull();
    expect((await rpc(consultora, "remessa_informacoes_lista", { _remessa: remessa })).ok).toBe(false);
    expect((await rpc(repC, "remessa_informacao_salvar", { _remessa: remessa, _party: semMaleta, _motivo: "pausa", _info: "" })).ok).toBe(false);
  });
});

describe("2. representante: acertos, remessas e checklist", () => {
  test("vê a remessa, a informação, quem ficou sem maleta e marca o acerto feito", async () => {
    const hoje = (await um<{ d: string }>(`select (now() at time zone 'America/Sao_Paulo')::date::text d`)).d;
    const fim = (await um<{ d: string }>(`select ((now() at time zone 'America/Sao_Paulo')::date + 7)::text d`)).d;
    const a = await rpc<{ a_fazer: { cycle_id: string; info_acerto: string | null }[]; remessas: { id: string; acertos_feitos: number }[] }>(repC, "rep_acertos", { _rep: repC.partyId, _de: hoje, _ate: fim });
    expect(a.erro).toBeNull();
    // recebida há 40 dias → acerto em 2 dias (42 dias do recebimento), dentro da semana
    expect(a.dados.a_fazer.find((x) => x.cycle_id === ciclo)?.info_acerto).toBe("Cobrar parcela de outubro no acerto");
    expect(a.dados.remessas.some((r) => r.id === remessa)).toBe(true);
    const info = await rpc<{ itens: { party_id: string; tem_maleta: boolean; sem_maleta_motivo: string | null; feito_em: string | null }[] }>(repC, "rep_remessa_informacoes", { _rep: repC.partyId, _remessa: remessa });
    expect(info.erro).toBeNull();
    expect(info.dados.itens.find((x) => x.party_id === semMaleta)?.sem_maleta_motivo).toBe("inadimplente");
    const m = await rpc<{ feito: boolean; feitos: number; total: number }>(repC, "rep_acerto_marcar", { _rep: repC.partyId, _remessa: remessa, _party: comMaleta, _feito: true });
    expect(m.erro).toBeNull();
    expect([m.dados.feitos, m.dados.total]).toEqual([1, 1]);
    expect((await rpc(repC, "rep_acerto_marcar", { _rep: repC.partyId, _remessa: remessa, _party: semMaleta, _feito: true })).erro).toContain("não tem maleta");
    const depois = await rpc<{ itens: { party_id: string; feito_em: string | null }[] }>(repC, "rep_remessa_informacoes", { _rep: repC.partyId, _remessa: remessa });
    expect(depois.dados.itens.find((x) => x.party_id === comMaleta)?.feito_em).not.toBeNull();
    expect((await rpc(repC, "rep_acerto_marcar", { _rep: repC.partyId, _remessa: remessa, _party: comMaleta, _feito: false })).dados).toMatchObject({ feito: false, feitos: 0 });
    // outro representante não vê nem marca
    expect((await rpc(outroRep, "rep_remessa_informacoes", { _rep: outroRep.partyId, _remessa: remessa })).ok).toBe(false);
    expect((await rpc(outroRep, "rep_acerto_marcar", { _rep: outroRep.partyId, _remessa: remessa, _party: comMaleta, _feito: true })).ok).toBe(false);
    expect((await rpc(outroRep, "rep_acertos", { _rep: repC.partyId, _de: hoje, _ate: fim })).ok).toBe(false);
  });
});
