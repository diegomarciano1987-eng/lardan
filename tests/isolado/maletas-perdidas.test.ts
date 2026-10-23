/**
 * 0130 — maleta perdida (baixa + fiado), pular acerto e maleta com o representante.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 900000 + Math.floor(Math.random() * 90000);
const REM = 70000 + Math.floor(Math.random() * 9000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, cobranca: Conta, cons: Conta, rep: Conta, repOutro: Conta;
let deposito = "", vA = "", praca = "", outraPraca = "";
const chave = (s: string) => `perd-${marca}-${s}`;
const imp = (tipo: string, linhas: unknown[]) => rpc(master, "legado_importar", { _tipo: tipo, _lote: `iso-perd-${base}`, _linhas: linhas });
const maletaLegado = (remessa: number, codcli: number, kit: number, tipo: string, env: number, dev: number, valorEnv: number, valorDev: number) => ({
  remessa, codcli, kit, tipo, emissao: "2025-03-01", fechamento: "", pecas_enviadas: env, pecas_devolvidas: dev, pecas_defeito: 0,
  valor_enviado: valorEnv, valor_devolvido: valorDev, nf_remessa: "1" });

async function primeiraTransferencia(c: string) {
  return (await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 order by seq desc limit 1`, [c])).id;
}

beforeAll(async () => {
  master = await criarConta({ nome: `perd-master-${base}`, papeis: ["master"], comParty: true });
  cobranca = await criarConta({ nome: `perd-cob-${base}`, papeis: ["cobranca"], comParty: true });
  cons = await criarConta({ nome: `perd-cons-${base}`, papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: `perd-rep-${base}`, papeis: ["representante"], comParty: true });
  repOutro = await criarConta({ nome: `perd-rep2-${base}`, papeis: ["representante"], comParty: true });
  deposito = await criarDeposito(`perd-${marca}`);
  vA = await criarVariante(`perd-a-${marca}`, 10000);
  await porEstoque(vA, deposito, 50);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`PERD ${marca}`])).linhas[0]!.id;
  outraPraca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`PERD2 ${marca}`])).linhas[0]!.id;
  await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                    on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`,
    [cons.partyId, rep.partyId, praca]);
});

describe("1. maleta perdida do SmallData vira fiado", () => {
  test("importar a perdida gera o fiado pelo varejo das peças que não voltaram, uma vez só", async () => {
    await imp("consultoras", [1, 2].map((i) => ({ codcli: base + i, nome: `Perd ${i}`, cpf: "", cidade: "A", uf: "PR", praca: "", ativo: "1" })));
    await adm.unsafe(`update public.legado_consultoras set party_id=$2, vinculo='manual' where codcli=$1`, [base + 1, cons.partyId]);
    await imp("remessas", [{ numero: REM, emissao: "2025-03-01", vencimento: "2025-04-15", status: "fechada", praca: "", representante: "" }]);
    // kit 1 voltou inteiro; kit 2 não voltou → só o kit 2 vira fiado
    await imp("maletas", [maletaLegado(REM, base + 1, 1, "perdida", 50, 50, 5000, 5000), maletaLegado(REM, base + 1, 2, "perdida", 40, 0, 4200, 0),
                          maletaLegado(REM, base + 2, 1, "perdida", 30, 0, 3000, 0)]);
    const t = await um<{ v: string; n: number }>(
      `select sum(t.valor_cents)::text v, count(*)::int n from public.financial_titles t where t.sistema_origem='maleta_perdida' and t.party_id=$1`, [cons.partyId]);
    expect(t).toEqual({ v: "420000", n: 1 });
    const f = await um<{ n: number }>(`select count(*)::int n from public.cob_fiado_linhas where party_id=$1 and lote='maleta_perdida'`, [cons.partyId]);
    expect(f.n).toBe(1);
    await rpc(master, "maletas_perdidas_smalldata_processar", { _aplicar: true });
    expect((await um<{ n: number }>(`select count(*)::int n from public.financial_titles where sistema_origem='maleta_perdida' and party_id=$1`, [cons.partyId])).n).toBe(1);
  });

  test("o fiado aparece no cockpit da consultora; a perdida não conta como na rua", async () => {
    const ck = await rpc<{ fiado: { valor_cents: number }[] }>(cobranca, "consultora_cockpit_financeiro", { _party: cons.partyId });
    expect(ck.erro).toBeNull();
    expect(ck.dados.fiado.some((x) => Number(x.valor_cents) === 420000)).toBe(true);
    const v = await rpc<{ smalldata: { lista: { remessa: number }[] } }>(master, "maletas_visibilidade", { _limite: 1000 });
    expect(v.dados.smalldata.lista.some((x) => x.remessa === REM)).toBe(false);
  });

  test("consultora sem cadastro fica pendente e ganha o fiado quando é ligada", async () => {
    const antes = await um<{ s: string }>(`select situacao s from public.maletas_perdidas where origem='smalldata' and remessa=$1 and codcli=$2`, [REM, base + 2]);
    expect(antes.s).toBe("sem_cadastro");
    const nova = await criarConta({ nome: `perd-nova-${base}`, papeis: ["consultora"], comParty: true });
    await adm.unsafe(`update public.legado_consultoras set party_id=$2, vinculo='manual' where codcli=$1`, [base + 2, nova.partyId]);
    const depois = await um<{ s: string; v: string }>(`select situacao s, valor_cents::text v from public.maletas_perdidas where origem='smalldata' and remessa=$1 and codcli=$2`, [REM, base + 2]);
    expect(depois).toEqual({ s: "fiado_gerado", v: "300000" });
  });

  test("aba da Cobrança lista; consultora não lê", async () => {
    const l = await rpc<{ lista: { remessa: number; situacao: string }[] }>(cobranca, "cob_maletas_perdidas", { _busca: String(REM) });
    expect(l.erro).toBeNull();
    expect(l.dados.lista.filter((x) => x.remessa === REM).length).toBe(2);
    expect((await rpc(cons, "cob_maletas_perdidas", {})).ok).toBe(false);
  });
});

describe("2. maleta do Lardan: baixa como perdida", () => {
  let ciclo = "", remessa = "";
  beforeAll(async () => {
    const r = await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito,
      _data_acerto: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) });
    remessa = r.dados.id;
    ciclo = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: cons.partyId })).dados.cycle_id;
    await rpc(master, "kit_item_upsert", { _cycle: ciclo, _variant: vA, _qty: 4 });
    await rpc(master, "kit_conferir", { _cycle: ciclo, _note: null });
    await rpc(master, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } });
    await rpc(cons, "kit_transfer_confirm", { _transfer: await primeiraTransferencia(ciclo), _payload: {} });
    const a = await rpc(cons, "kit_aceitar", { _cycle: ciclo, _itens: [{ variant_id: vA, qty_accepted: 4, qty_divergent: 0 }], _idempotency_key: chave("aceite") });
    if (!a.ok) throw new Error(a.erro!);
  });

  test("pular acerto: vai para o acerto da próxima remessa da praça", async () => {
    const semProxima = await rpc(master, "kit_pular_acerto", { _cycle: ciclo, _motivo: "não voltou no acerto" });
    expect(semProxima.erro).toContain("informe a nova data");
    const prox = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    await rpc(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito, _data_acerto: prox });
    const r = await rpc<{ para: string }>(cobranca, "kit_pular_acerto", { _cycle: ciclo, _motivo: "não voltou no acerto" });
    expect(r.erro).toBeNull();
    expect(r.dados.para).toBe(prox);
    expect((await rpc(cons, "kit_pular_acerto", { _cycle: ciclo, _motivo: "x" })).ok).toBe(false);
  });

  test("baixa: estoque sai como perda, maleta encerra, fiado pelo varejo, sem nota fiscal", async () => {
    expect((await rpc(master, "kit_maleta_perdida", { _cycle: ciclo, _motivo: "" })).erro).toContain("motivo");
    const r = await rpc<{ pecas: number; valor_cents: number; title_id: string }>(cobranca, "kit_maleta_perdida", { _cycle: ciclo, _motivo: "consultora sumiu" });
    expect(r.erro).toBeNull();
    expect(r.dados).toMatchObject({ pecas: 4, valor_cents: 40000 });
    const c = await um<{ s: string; lost: number }>(
      `select c.status::text s, (select sum(qty_lost)::int from public.kit_balances b where b.cycle_id=c.id) lost from public.kit_cycles c where c.id=$1`, [ciclo]);
    expect(c).toEqual({ s: "encerrada", lost: 4 });
    const loc = await um<{ q: number }>(`select coalesce(sum(sb.quantity),0)::int q from public.stock_balances sb join public.locations l on l.id=sb.location_id
                                          join public.kits k on k.code=l.code join public.kit_cycles c on c.kit_id=k.id where c.id=$1`, [ciclo]);
    expect(loc.q).toBe(0);
    const t = await um<{ v: string; o: string }>(`select valor_cents::text v, sistema_origem o from public.financial_titles where id=$1`, [r.dados.title_id]);
    expect(t).toEqual({ v: "40000", o: "maleta_perdida" });
    const repetida = await rpc<{ repetida: boolean }>(master, "kit_maleta_perdida", { _cycle: ciclo, _motivo: "de novo" });
    expect(repetida.dados.repetida).toBe(true);
    const fiscal = await um<{ n: number }>(`select count(*)::int n from public.audit_logs where entity_id=$1 and action ilike '%fiscal%'`, [ciclo]);
    expect(fiscal.n).toBe(0);
  });
});

describe("3. pular acerto de maleta do SmallData", () => {
  const R1 = REM + 1, R2 = REM + 2;
  test("vai para o próximo acerto da mesma praça e deixa de ficar vencida", async () => {
    await imp("pracas", [{ codigo: 9000 + (base % 900), nome: `PRACA ${base}`, dias: "", cidades: "" }]);
    const pc = 9000 + (base % 900);
    await imp("remessas", [
      { numero: R1, emissao: "2025-01-01", vencimento: "2025-02-15", status: "aberta", praca: pc, representante: "" },
      { numero: R2, emissao: "2025-02-01", vencimento: "2099-03-15", status: "aberta", praca: pc, representante: "" }]);
    await imp("maletas", [maletaLegado(R1, base + 1, 1, "remessa", 50, 0, 5000, 0)]);
    const r = await rpc<{ de: string; para: string }>(cobranca, "legado_maleta_pular_acerto", { _remessa: R1, _codcli: base + 1, _motivo: "pulou o acerto" });
    expect(r.erro).toBeNull();
    expect(r.dados).toEqual({ de: "2025-02-15", para: "2099-03-15" });
    const m = await rpc<{ smalldata: { remessa: number; vencimento: string; vencimento_original: string; atrasada: boolean }[] }>(
      master, "consultora_maletas", { _party: cons.partyId });
    expect(m.dados.smalldata.find((x) => x.remessa === R1)).toMatchObject({ vencimento: "2099-03-15", vencimento_original: "2025-02-15", atrasada: false });
  });
});

describe("4. maleta da remessa com o representante", () => {
  let ciclo = "", remessa = "", lead = "";
  beforeAll(async () => {
    remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito,
      _data_acerto: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) })).dados.id;
    lead = (await um<{ id: string }>(
      `insert into public.leads (full_name, whatsapp, city, uf, privacy_version, stage_id, representante_party_id)
       values ($1,'43999998888','Ibiporã','PR','v1',(select id from public.candidatura_stages order by sort_order limit 1),$2) returning id`,
      [`Candidata ${marca}`, rep.partyId])).id;
  });

  test("abre sem consultora, sai para o representante e ele confirma", async () => {
    const r = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta_representante", { _remessa: remessa });
    expect(r.erro).toBeNull();
    ciclo = r.dados.cycle_id;
    await rpc(master, "kit_item_upsert", { _cycle: ciclo, _variant: vA, _qty: 3 });
    await rpc(master, "kit_conferir", { _cycle: ciclo, _note: null });
    expect((await rpc(master, "kit_expedir", { _cycle: ciclo, _payload: { rota: "representante" } })).erro).toBeNull();
    const m = await rpc<{ a_receber: { transfer_id: string }[] }>(rep, "rep_portal_maletas", { _rep: rep.partyId });
    expect(m.dados.a_receber.length).toBe(1);
    expect((await rpc(rep, "kit_transfer_confirm", { _transfer: m.dados.a_receber[0]!.transfer_id, _payload: {} })).erro).toBeNull();
    const d = await rpc<{ sem_consultora: { cycle_id: string }[] }>(rep, "rep_portal_maletas", { _rep: rep.partyId });
    expect(d.dados.sem_consultora.map((x) => x.cycle_id)).toContain(ciclo);
    expect((await rpc(repOutro, "rep_portal_maletas", { _rep: rep.partyId })).ok).toBe(false);
  });

  test("passa para a candidata dele: ela vira consultora da carteira e a maleta segue para ela", async () => {
    const op = await rpc<{ tipo: string; id: string }[]>(rep, "rep_maleta_destinatarias", { _rep: rep.partyId, _busca: `Candidata ${marca}` });
    expect(op.dados.some((x) => x.tipo === "candidata" && x.id === lead)).toBe(true);
    expect((await rpc(repOutro, "rep_maleta_repassar", { _rep: repOutro.partyId, _cycle: ciclo, _lead: lead })).ok).toBe(false);
    const r = await rpc<{ consultora_party_id: string; nova_consultora: boolean }>(rep, "rep_maleta_repassar", { _rep: rep.partyId, _cycle: ciclo, _lead: lead });
    expect(r.erro).toBeNull();
    expect(r.dados.nova_consultora).toBe(true);
    const p = r.dados.consultora_party_id;
    const perfil = await um<{ rep: string; praca: string }>(`select representative_party_id::text rep, praca_id::text praca from public.consultant_profiles where party_id=$1`, [p]);
    expect(perfil).toEqual({ rep: rep.partyId, praca });
    const t = await um<{ n: number }>(`select count(*)::int n from public.kit_transfers where cycle_id=$1 and to_party_id=$2 and status='transito'`, [ciclo, p]);
    expect(t.n).toBe(1);
    expect((await um<{ s: string }>(`select status s from public.leads where id=$1`, [lead])).s).toBe("aprovado");
  });

  test("não passa para consultora de outra carteira", async () => {
    const r2 = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta_representante", { _remessa: remessa });
    const c2 = r2.dados.cycle_id;
    await rpc(master, "kit_item_upsert", { _cycle: c2, _variant: vA, _qty: 1 });
    await rpc(master, "kit_conferir", { _cycle: c2, _note: null });
    await rpc(master, "kit_expedir", { _cycle: c2, _payload: { rota: "representante" } });
    await rpc(rep, "kit_transfer_confirm", { _transfer: await primeiraTransferencia(c2), _payload: {} });
    const outra = await criarConta({ nome: `perd-outra-${base}`, papeis: ["consultora"], comParty: true });
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)`, [outra.partyId, repOutro.partyId, outraPraca]);
    expect((await rpc(rep, "rep_maleta_repassar", { _rep: rep.partyId, _cycle: c2, _consultora: outra.partyId })).erro).toContain("não é da sua carteira");
    expect((await rpc(rep, "rep_maleta_repassar", { _rep: rep.partyId, _cycle: c2, _consultora: cons.partyId })).erro).toBeNull();
  });
});
