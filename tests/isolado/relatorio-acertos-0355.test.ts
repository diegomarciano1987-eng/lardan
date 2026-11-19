/**
 * 0355 (Diego, 19/11/2026) — relatório de acertos por período (Remessas). Banco ISOLADO, dados sintéticos.
 *  - lista quem tem maleta na rua com acerto dentro do período: Lardan e SmallData, com praça, representante e telefone;
 *  - fora do período não entra; maleta já devolvida (fechamento) não entra;
 *  - consultora não lê; período invertido ou maior que 3 meses é recusado.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const dia = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
type Linha = { fonte: string; maleta: string; remessa: number; acerto: string; consultora: string; codigo: string; praca: string; representante: string; telefone: string | null; pecas: number };

let master: Conta, ana: Conta, rep: Conta;
let deposito = "", praca = "", ciclo = "", nomePraca = "";
const codcli = 900000 + Math.floor(Math.random() * 90000);
const remSd = 80000 + Math.floor(Math.random() * 9000);

beforeAll(async () => {
  master = await criarConta({ nome: `ra-master-${marca}`, papeis: ["master"], comParty: true });
  ana = await criarConta({ nome: `ra-ana-${marca}`, papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: `ra-rep-${marca}`, papeis: ["representante"], comParty: true });
  deposito = await criarDeposito(`ra-${marca}`);
  nomePraca = `Praça RA ${marca}`;
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [nomePraca])).linhas[0]!.id;
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [ana.partyId]);
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id=excluded.praca_id`, [ana.partyId, praca]);
  await adm.unsafe(`insert into public.contact_points (party_id, kind, value, is_primary) values ($1,'whatsapp','(43) 99911-2233',true)`, [ana.partyId]);
  const v = await criarVariante(`ra-v-${marca}`, 5000);
  await porEstoque(v, deposito, 10);
  const rr = await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito, _data_acerto: dia(9), _representante: rep.partyId });
  if (rr.erro) throw new Error(`remessa_criar: ${rr.erro}`);
  const mm = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rr.dados.id, _consultora: ana.partyId });
  if (mm.erro) throw new Error(`remessa_abrir_maleta: ${mm.erro}`);
  ciclo = mm.dados.cycle_id;
  await rpc(master, "kit_item_upsert", { _cycle: ciclo, _variant: v, _qty: 3 });
  await rpc(master, "kit_conferir", { _cycle: ciclo, _note: null });
  const e = await rpc(master, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } });
  if (e.erro) throw new Error(e.erro);
  // SmallData: uma maleta na rua (acerto em 5 dias) e uma já devolvida
  await adm.unsafe(`insert into public.legado_consultoras (codcli, nome, celular, cidade, uf) values ($1,$2,'43988887777','Ibiporã','PR')`, [codcli, `RA SmallData ${marca}`]);
  await adm.unsafe(`insert into public.legado_remessas (numero, emissao, vencimento, status, praca, representante) values ($1,$2,$3,'aberta',777,7777),($4,$2,$3,'aberta',777,7777)`, [remSd, dia(-30), dia(5), remSd + 1]);
  await adm.unsafe(`insert into public.legado_maletas (remessa, codcli, kit, tipo, emissao, pecas_enviadas, valor_enviado_cents) values ($1,$2,1,'remessa',$3,40,200000)`, [remSd, codcli, dia(-30)]);
  await adm.unsafe(`insert into public.legado_maletas (remessa, codcli, kit, tipo, emissao, fechamento, pecas_enviadas, valor_enviado_cents) values ($1,$2,2,'remessa',$3,$4,40,200000)`, [remSd + 1, codcli, dia(-30), dia(-1)]);
});

describe("0355 — relatório de acertos por período", () => {
  test("lista Lardan e SmallData do período, com praça, representante e telefone", async () => {
    const r = await rpc<{ linhas: Linha[] }>(master, "acertos_relatorio", { _de: dia(0), _ate: dia(10) });
    expect(r.erro).toBeNull();
    const lardan = r.dados.linhas.find((l) => l.consultora.endsWith(`ra-ana-${marca}`));
    expect(lardan).toMatchObject({ fonte: "lardan", acerto: dia(9), representante: `ISO ra-rep-${marca}`, telefone: "5543999112233", pecas: 3 });
    expect(lardan!.praca.toLowerCase()).toBe(nomePraca.toLowerCase());
    const sd = r.dados.linhas.filter((l) => l.codigo === String(codcli));
    expect(sd.length).toBe(1);                                   // a devolvida não entra
    expect(sd[0]).toMatchObject({ fonte: "smalldata", remessa: remSd, acerto: dia(5), telefone: "43988887777", pecas: 40 });
  });

  test("fora do período não entra", async () => {
    const r = await rpc<{ linhas: Linha[] }>(master, "acertos_relatorio", { _de: dia(6), _ate: dia(8) });
    expect(r.dados.linhas.some((l) => l.consultora.endsWith(`ra-ana-${marca}`) || l.codigo === String(codcli))).toBe(false);
  });

  test("consultora não lê; período inválido é recusado", async () => {
    expect((await rpc(ana, "acertos_relatorio", { _de: dia(0), _ate: dia(10) })).erro).toContain("Sem permissão");
    expect((await rpc(master, "acertos_relatorio", { _de: dia(10), _ate: dia(0) })).erro).toContain("Período inválido");
    expect((await rpc(master, "acertos_relatorio", { _de: dia(0), _ate: dia(120) })).erro).toContain("3 meses");
  });
});
