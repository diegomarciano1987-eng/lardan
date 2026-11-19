/**
 * 0357 (Diego, 19/11/2026) — no Relatório de acertos, o representante das maletas SmallData vem do cadastro de Representantes.
 *  - vínculo antigo apontando para uma CONSULTORA (caso 3009 → Gracielle) não vira nome de representante;
 *  - o representante certo é achado pelo nome (único cadastro com papel representante), mesmo id das maletas Lardan dele;
 *  - sem cadastro com aquele nome, fica o nome do SmallData; o vínculo antigo não é alterado.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const dia = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
type Linha = { codigo: string; representante: string; rep_id: string | null };

let master: Conta, consultoraErrada: Conta, rep: Conta;
const base = 700000 + Math.floor(Math.random() * 90000);
const codRep = 60000 + Math.floor(Math.random() * 9000);
const [cliA, cliB] = [base, base + 1];
const [remA, remB] = [70000 + Math.floor(Math.random() * 9000), 0];

beforeAll(async () => {
  master = await criarConta({ nome: `rr-master-${marca}`, papeis: ["master"], comParty: true });
  consultoraErrada = await criarConta({ nome: `rr-gracielle-${marca}`, papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: `rr-rep-${marca}`, papeis: ["representante"], comParty: true });
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [consultoraErrada.partyId]);
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'representante') on conflict do nothing`, [rep.partyId]);
  const nomeRep = ((await adm.unsafe(`select display_name from public.parties where id=$1`, [rep.partyId])) as { display_name: string }[])[0]!.display_name;
  // vínculo antigo errado: código do representante ligado ao cadastro de uma consultora; nome em maiúsculas como no SmallData
  await adm.unsafe(`insert into public.legado_representantes (codigo, nome, party_id) values ($1,$2,$3),($4,$5,null)`,
    [codRep, nomeRep.toUpperCase(), consultoraErrada.partyId, codRep + 1, `MARCOS SEM CADASTRO ${marca}`.toUpperCase()]);
  await adm.unsafe(`insert into public.legado_consultoras (codcli, nome) values ($1,$2),($3,$4)`, [cliA, `RR A ${marca}`, cliB, `RR B ${marca}`]);
  await adm.unsafe(`insert into public.legado_remessas (numero, emissao, vencimento, status, praca, representante) values ($1,$2,$3,'aberta',777,$4),($5,$2,$3,'aberta',777,$6)`,
    [remA, dia(-30), dia(5), codRep, remA + 1, codRep + 1]);
  await adm.unsafe(`insert into public.legado_maletas (remessa, codcli, kit, tipo, emissao, pecas_enviadas, valor_enviado_cents) values ($1,$2,1,'remessa',$3,40,200000),($4,$5,1,'remessa',$3,40,200000)`,
    [remA, cliA, dia(-30), remA + 1, cliB]);
  void remB;
});

describe("0357 — representante do SmallData vem do cadastro de Representantes", () => {
  test("vínculo antigo para uma consultora não aparece; vem o representante do cadastro", async () => {
    const r = await rpc<{ linhas: Linha[] }>(master, "acertos_relatorio", { _de: dia(0), _ate: dia(10) });
    expect(r.erro).toBeNull();
    const a = r.dados.linhas.find((l) => l.codigo === String(cliA))!;
    expect(a.rep_id).toBe(rep.partyId);
    expect(a.representante).not.toContain("gracielle");
    expect(a.representante.toLowerCase()).toContain(`rr-rep-${marca}`);
  });

  test("sem cadastro de representante com aquele nome, fica o nome do SmallData", async () => {
    const r = await rpc<{ linhas: Linha[] }>(master, "acertos_relatorio", { _de: dia(0), _ate: dia(10) });
    const b = r.dados.linhas.find((l) => l.codigo === String(cliB))!;
    expect(b.representante).toBe(`MARCOS SEM CADASTRO ${marca}`.toUpperCase());
    expect(b.rep_id).toBe(`leg:${codRep + 1}`);
  });

  test("o vínculo antigo não é alterado", async () => {
    const v = (await adm.unsafe(`select party_id from public.legado_representantes where codigo=$1`, [codRep])) as { party_id: string }[];
    expect(v[0]!.party_id).toBe(consultoraErrada.partyId);
  });
});
