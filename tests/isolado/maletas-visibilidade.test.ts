/**
 * Maletas da consultora (0120) — banco ISOLADO, dados sintéticos.
 *  1. Maleta do Lardan aparece no app só expedida/em trânsito/recebida/operação/acerto e com login na MESMA pessoa.
 *  2. Cadastro repetido (maleta num, login no outro) é apontado.
 *  3. Maleta na rua só pelo SmallData aparece no cockpit, separada.
 *  4. Só a equipe lê.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 500000 + Math.floor(Math.random() * 90000);
const REM = 40000 + Math.floor(Math.random() * 9000);
let master: Conta, ana: Conta, beaLogin: Conta;
let bea = "", cicloAna = "", cicloMontagem = "", cicloBea = "";

async function ciclo(party: string, status: string) {
  const kit = (await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO VIS ${Math.random()}`])).id;
  const c = (await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id) values ($1,1,$2) returning id`, [kit, party])).id;
  await adm.unsafe(`update public.kit_cycles set status=$2::kit_status where id=$1`, [c, status]);
  return c;
}

beforeAll(async () => {
  master = await criarConta({ nome: "master-vis", papeis: ["master"], comParty: true });
  ana = await criarConta({ nome: `ana-vis-${base}`, papeis: ["consultora"], comParty: true });
  // Bea: maleta num cadastro sem login; o login dela está em OUTRO cadastro com o mesmo nome
  beaLogin = await criarConta({ nome: `bea-vis-${base}`, papeis: ["consultora"], comParty: true });
  bea = (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`,
    [`ISO bea-vis-${base}`])).id;
  cicloAna = await ciclo(ana.partyId!, "operacao");
  cicloMontagem = await ciclo(ana.partyId!, "montagem");
  cicloBea = await ciclo(bea, "operacao");

  // SmallData: Ana tem uma maleta na rua sem acerto
  const imp = (tipo: string, linhas: unknown[]) => rpc(master, "legado_importar", { _tipo: tipo, _lote: `iso-vis-${base}`, _linhas: linhas });
  await imp("consultoras", [{ codcli: base, nome: "Ana", cpf: "", cidade: "A", uf: "PR", praca: "", ativo: "1" }]);
  await imp("remessas", [{ numero: REM, emissao: "2026-09-01", vencimento: "2026-10-15", status: "aberta", praca: "", representante: "" }]);
  await imp("maletas", [{ remessa: REM, codcli: base, kit: 1, tipo: "remessa", emissao: "2026-09-01", fechamento: "", pecas_enviadas: 60,
    pecas_devolvidas: 0, pecas_defeito: 0, valor_enviado: 6000, valor_devolvido: 0, nf_remessa: "555" }]);
  await adm.unsafe(`update public.legado_consultoras set party_id=$2, vinculo='manual' where codcli=$1`, [base, ana.partyId]);
});

afterAll(async () => {
  await adm.unsafe(`delete from public.legado_maletas where codcli=$1`, [base]);
  await adm.unsafe(`delete from public.legado_remessas where numero=$1`, [REM]);
  await adm.unsafe(`update public.legado_consultoras set party_id=null where codcli=$1`, [base]);
  await adm.unsafe(`delete from public.legado_consultoras where codcli=$1`, [base]);
});

interface Res {
  pessoa: { login_ativo: boolean; codigos_smalldata: number[] };
  lardan: { cycle_id: string; status: string; motivo_invisivel: string | null }[];
  smalldata: { remessa: number; pecas: number; atrasada: boolean; nf_remessa: string }[];
  mesma_pessoa: { party_id: string; motivo: string; tem_login: boolean }[];
}

describe("maletas da consultora", () => {
  test("maleta em operação aparece; em montagem ainda não; SmallData na rua listada à parte", async () => {
    const r = await rpc<Res>(master, "consultora_maletas", { _party: ana.partyId });
    expect(r.erro).toBeNull();
    expect(r.dados.pessoa.login_ativo).toBe(true);
    expect(r.dados.lardan.find((m) => m.cycle_id === cicloAna)!.motivo_invisivel).toBeNull();
    expect(r.dados.lardan.find((m) => m.cycle_id === cicloMontagem)!.motivo_invisivel).toContain("ainda na matriz");
    expect(r.dados.smalldata).toEqual([expect.objectContaining({ remessa: REM, pecas: 60, nf_remessa: "555" })]);
  });

  test("maleta no cadastro sem login com login em outro cadastro da mesma pessoa", async () => {
    const r = await rpc<Res>(master, "consultora_maletas", { _party: bea });
    expect(r.dados.pessoa.login_ativo).toBe(false);
    expect(r.dados.lardan[0]!.motivo_invisivel).toContain("OUTRO cadastro");
    expect(r.dados.mesma_pessoa).toContainEqual(expect.objectContaining({ party_id: beaLogin.partyId, motivo: "mesmo nome", tem_login: true }));
  });

  test("panorama da rede", async () => {
    const v = await rpc<{ lardan: { invisiveis: number; lista: { cycle_id: string }[] }; smalldata: { maletas: number; por_remessa: { remessa: number }[] } }>(
      master, "maletas_visibilidade", { _limite: 1000 });
    expect(v.erro).toBeNull();
    expect(v.dados.lardan.lista.some((m) => m.cycle_id === cicloBea)).toBe(true);
    expect(v.dados.lardan.lista.some((m) => m.cycle_id === cicloAna)).toBe(false);
    expect(v.dados.lardan.lista.some((m) => m.cycle_id === cicloMontagem)).toBe(false);   // ainda na matriz: fora do panorama
    expect(v.dados.smalldata.por_remessa.some((r) => r.remessa === REM)).toBe(true);
  });

  test("consultora não lê", async () => {
    expect((await rpc(ana, "consultora_maletas", { _party: ana.partyId })).ok).toBe(false);
    expect((await rpc(ana, "maletas_visibilidade", {})).ok).toBe(false);
  });
});
