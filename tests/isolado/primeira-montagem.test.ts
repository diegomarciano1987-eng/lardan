/**
 * 0136 — auditoria "do cadastro à primeira montagem". Banco ISOLADO, dados sintéticos.
 *
 * Consultora antiga do SmallData → cadastro com o número dela → praça e representante
 * pelo histórico → colaboradora entra por código e monta a maleta (remessa, bipagem com o
 * tipo da peça pela categoria do produto, metas pelo histórico, conferência, expedição)
 * → consultora recebe e aceita → cockpit e portal do representante enxergam tudo.
 * Também: login por código endurecido e porta da Operação só para equipe/colaboradora.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, ler, porEstoque, rpc, rpcServico, type Conta } from "./base";
import { portaLiberada } from "../../src/lib/portas";
import { COLAB_MODULOS, PACOTE_MONTAGEM, capsDeEscolha } from "../../src/lib/colab-modulos";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 20000 + Math.floor(Math.random() * 70000);
const PRACA = 900 + Math.floor(Math.random() * 90000);
const REP = base + 1;
const ANA = base + 2;
const BIA = base + 3;
const REM = 600000 + base;
const codColab = String(10000000 + base).slice(-8);
const codColab2 = String(20000000 + base).slice(-8);

let master: Conta, colab: Conta, rep: Conta, diretora: Conta, consultoraLogin: Conta;
let praca = "", deposito = "", ana = "", remessa = "", ciclo = "", vBracelete = "", vBrinco = "";

async function importar(tipo: string, linhas: Record<string, unknown>[]) {
  const r = await rpc(master, "legado_importar", { _tipo: tipo, _lote: `iso-1a-${base}`, _linhas: linhas });
  if (r.erro) throw new Error(`${tipo}: ${r.erro}`);
}
const maleta = (remessa: number, c: number, env: number, dev: number, fech: string) =>
  ({ remessa, codcli: c, kit: 1, tipo: "remessa", emissao: "2025-01-01", fechamento: fech, pecas_enviadas: env,
     pecas_devolvidas: dev, pecas_defeito: 0, valor_enviado: env * 60, valor_devolvido: dev * 60 });
const cat = (remessa: number, c: number, categoria: string, env: number, dev: number) =>
  ({ remessa, codcli: c, kit: 1, categoria, pecas_enviadas: env, pecas_devolvidas: dev, valor_enviado: env * 60, valor_devolvido: dev * 60 });

async function produto(nome: string, categoria: string, preco: number) {
  const cat = (await um<{ id: string }>(
    `select id from public.categories where parent_id is null and upper(name)=upper($1) limit 1`, [categoria]))?.id
    ?? (await um<{ id: string }>(`insert into public.categories (name, slug) values ($1,$2) returning id`,
      [categoria, `${categoria.toLowerCase()}-${base}`])).id;
  const p = (await um<{ id: string }>(
    `insert into public.products (name, slug, status, category_id, internal_code) values ($1,$2,'rascunho',$3,$4) returning id`,
    [nome, `iso-1a-${base}-${Math.random().toString(36).slice(2, 8)}`, cat, `ZZ${base}${Math.floor(Math.random() * 1e4)}`])).id;
  return (await um<{ id: string }>(
    `insert into public.product_variants (product_id, sku, label, price_cents, is_active) values ($1,$2,'U',$3,true) returning id`,
    [p, `ZZ-${base}-${Math.random().toString(36).slice(2, 8)}`, preco])).id;
}

beforeAll(async () => {
  master = await criarConta({ nome: `1a-master-${base}`, papeis: ["master"], comParty: true });
  colab = await criarConta({ nome: `1a-colab-${base}`, papeis: [], comParty: true });
  rep = await criarConta({ nome: `1a-rep-${base}`, papeis: ["representante"], comParty: true });
  diretora = await criarConta({ nome: `1a-dir-${base}`, papeis: ["diretoria"], comParty: true });
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'representante'),($2,'colaborador'),($3,'colaborador')`,
    [rep.partyId, colab.partyId, diretora.partyId]);
  await adm.unsafe(`insert into public.cob_pracas (codigo, nome) values ($1,$2)`, [PRACA, `PRACA 1A ${base}`]);
  praca = (await um<{ id: string }>(`select id from public.cob_pracas where codigo=$1`, [PRACA])).id;
  deposito = await criarDeposito(`1a-${base}`);

  // histórico SmallData sintético: Ana (2 maletas fechadas, vende bracelete), praça e representante
  await importar("pracas", [{ codigo: PRACA, nome: `PRACA 1A ${base}`, dias: "42", cidades: "Ibiporã/PR" }]);
  await importar("representantes", [{ codigo: REP, nome: `Rep Historico ${base}`, cpf: "", ativo: "1", comissao_pct: "", pracas: String(PRACA) }]);
  await importar("consultoras", [
    { codcli: ANA, nome: `Ana Primeira ${base}`, cpf: "", cidade: "Ibiporã", uf: "PR", praca: String(PRACA), representante: String(REP), ativo: "1" },
    { codcli: BIA, nome: `Bia Primeira ${base}`, cpf: "", cidade: "Ibiporã", uf: "PR", praca: String(PRACA), representante: String(REP), ativo: "1" },
  ]);
  await importar("remessas", [1, 2].map((i) =>
    ({ numero: REM + i, emissao: "2025-01-01", vencimento: "2025-02-15", status: "fechada", praca: String(PRACA), representante: String(REP) })));
  await importar("maletas", [maleta(REM + 1, ANA, 60, 30, "2025-02-10"), maleta(REM + 2, ANA, 70, 35, "2025-04-10"),
    maleta(REM + 1, BIA, 40, 30, "2025-02-10")]);
  await importar("maleta_categorias", [
    cat(REM + 1, ANA, "BRINCO", 40, 25), cat(REM + 1, ANA, "BRACELETE", 20, 5),
    cat(REM + 2, ANA, "BRINCO", 45, 28), cat(REM + 2, ANA, "BRACELETE", 25, 7),
  ]);
  expect((await rpc(master, "legado_vincular", {})).erro).toBeNull();

  vBracelete = await produto(`Bracelete Elo DOU ${base}`, "Bracelete", 12900);
  vBrinco = await produto(`Brinco Argola DOU ${base}`, "Brinco", 6900);
  await porEstoque(vBracelete, deposito, 30);
  await porEstoque(vBrinco, deposito, 60);
});

describe("1. cadastro pelo histórico", () => {
  test("Ana vira consultora com o número do SmallData e a praça do histórico", async () => {
    const c0 = await adm.reserve();
    try {
      await c0.unsafe(`set role service_role`);
      await c0.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
      await c0.unsafe(`select public.legado_consultoras_cadastrar($1)`, [`iso-1a-${base}`]);
    } finally {
      try { await c0.unsafe(`reset role`); await c0.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
      c0.release();
    }
    ana = (await um<{ p: string }>(`select party_id::text p from public.legado_consultoras where codcli=$1`, [ANA])).p;
    expect(ana).toBeTruthy();
    expect((await rpc(master, "party_codigo_smalldata_adotar", { _party: ana })).erro).toBeNull();
    const c = await um<{ code: string; praca: string | null; rep: string | null }>(
      `select p.code, cp.praca_id::text praca, cp.representative_party_id::text rep
         from public.parties p join public.consultant_profiles cp on cp.party_id=p.id where p.id=$1`, [ana]);
    expect(c.code).toBe(String(ANA));
    expect(c.praca).toBe(praca);
    expect(c.rep).toBeNull(); // o cadastro do histórico não liga o representante: é o que a 0136 corrige
  });

  test("0136: representante do histórico liga ao cadastro (só o Master; prévia não grava)", async () => {
    const negado = await rpc(colab, "legado_representante_vincular", { _codigo: REP, _party: rep.partyId });
    expect(negado.ok).toBe(false);
    expect((await rpc(master, "legado_representante_vincular", { _codigo: REP, _party: colab.partyId })).erro).toContain("representante");
    const r = await rpc<{ codigo: number; party_id: string }>(master, "legado_representante_vincular", { _codigo: REP, _party: rep.partyId });
    expect(r.erro).toBeNull();
    expect((await um<{ v: string }>(`select vinculo v from public.legado_representantes where codigo=$1`, [REP])).v).toBe("manual");
  });

  test("0136: carteira pelo SmallData — prévia, aplicação, sem sobrescrever e portal do representante", async () => {
    const previa = await rpc<{ aplicado: boolean; representante: number; praca: number }>(master, "consultoras_vinculo_smalldata", { _aplicar: false });
    expect(previa.erro).toBeNull();
    expect(previa.dados.aplicado).toBe(false);
    expect(previa.dados.representante).toBeGreaterThanOrEqual(1);
    expect((await um<{ r: string | null }>(`select representative_party_id::text r from public.consultant_profiles where party_id=$1`, [ana])).r).toBeNull();
    expect((await rpc(colab, "consultoras_vinculo_smalldata", { _aplicar: true })).ok).toBe(false);

    const ap = await rpc<{ aplicado: boolean; lote: string }>(master, "consultoras_vinculo_smalldata", { _aplicar: true });
    expect(ap.erro).toBeNull();
    expect((await um<{ r: string }>(`select representative_party_id::text r from public.consultant_profiles where party_id=$1`, [ana])).r).toBe(rep.partyId!);
    const port = await rpc(rep, "rep_portal_consultoras", { _rep: rep.partyId });
    expect(JSON.stringify(port.dados)).toContain(ana);

    // quem já tem vínculo não muda
    const outro = await criarConta({ nome: `1a-rep2-${base}`, papeis: ["representante"], comParty: true });
    await adm.unsafe(`update public.consultant_profiles set representative_party_id=$2 where party_id=$1`, [ana, outro.partyId]);
    await rpc(master, "consultoras_vinculo_smalldata", { _aplicar: true });
    expect((await um<{ r: string }>(`select representative_party_id::text r from public.consultant_profiles where party_id=$1`, [ana])).r).toBe(outro.partyId!);
    await adm.unsafe(`update public.consultant_profiles set representative_party_id=$2 where party_id=$1`, [ana, rep.partyId]);
  });

  test("tela de vínculo: o representante sugere a praça dela", async () => {
    const v = await rpc<{ pracas: { id: string }[]; sugestao: string | null }>(master, "rep_pracas_vinculo", { _rep: rep.partyId, _consultora: ana });
    expect(v.erro).toBeNull();
    expect(v.dados.pracas.map((p) => p.id)).toContain(praca);
    expect(v.dados.sugestao).toBe(praca);
  });
});

describe("2. colaboradora por código monta a maleta", () => {
  test("Master libera o pacote de montagem; a colaboradora não vê custo nem financeiro", async () => {
    await adm.unsafe(`insert into public.consultant_profiles(party_id,representative_party_id) values ($1,$2) on conflict(party_id) do update set representative_party_id=excluded.representative_party_id`, [colab.partyId, rep.partyId]);
    expect((await rpcServico("colab_acesso_registrar", { _user_id: colab.uid, _party_id: colab.partyId, _codigo: codColab, _actor: master.uid })).erro).toBeNull();
    const esc = Object.fromEntries(COLAB_MODULOS.map((m) => [m.id, PACOTE_MONTAGEM.includes(m.id) ? "alterar" : "nao"])) as Record<string, "alterar" | "nao">;
    const r = await rpcServico<string[]>("colab_modulos_definir", { _user_id: colab.uid, _caps: capsDeEscolha(esc), _financeiro: false, _actor: master.uid });
    expect(r.erro).toBeNull();
    expect((await rpc<boolean>(colab, "has_capability", { _user_id: colab.uid, _cap: "kit.manage" })).dados).toBe(true);
    expect((await rpc<boolean>(colab, "has_capability", { _user_id: colab.uid, _cap: "catalog.cost.view" })).dados).toBe(false);
    expect((await rpc<boolean>(colab, "has_capability", { _user_id: colab.uid, _cap: "finance.view" })).dados).toBe(false);
  });

  test("cria a remessa (número depois do SmallData) e abre a maleta da Ana", async () => {
    const r = await rpc<{ id: string; numero: number }>(colab, "remessa_criar", {
      _praca: praca, _representante: rep.partyId, _deposito: deposito,
      _data_acerto: new Date(Date.now() + 42 * 864e5).toISOString().slice(0, 10),
    });
    expect(r.erro).toBeNull();
    remessa = r.dados.id;
    expect(r.dados.numero).toBeGreaterThan(REM + 2);
    const lista = await rpc(colab, "praca_consultoras", { _praca: praca });
    expect(lista.erro).toBeNull();
    expect(JSON.stringify(lista.dados)).toContain(ana);
    const m = await rpc<{ cycle_id: string }>(colab, "remessa_abrir_maleta", { _remessa: remessa, _consultora: ana });
    expect(m.erro).toBeNull();
    ciclo = m.dados.cycle_id;
  });

  test("metas da bipagem saem do histórico dela (bracelete conta como pulseira)", async () => {
    const m = await rpc<{ modo_sugerido: string; maletas_fechadas: number; metas_historico: Record<string, number> | null }>(
      colab, "montagem_metas_ciclo", { _cycle: ciclo, _total: 60 });
    expect(m.erro).toBeNull();
    expect(m.dados.modo_sugerido).toBe("historico");
    expect(m.dados.maletas_fechadas).toBe(2);
    expect(m.dados.metas_historico!["pulseira"]).toBeGreaterThan(0);
  });

  test("0136: tipo da peça na bipagem vem da categoria do produto e do mesmo de-para das metas", async () => {
    const t = await ler<{ variant_id: string; tipo: string }>(colab, `select * from public.variantes_tipo_peca($1::uuid[])`, [`{${vBracelete},${vBrinco}}`]);
    expect(t.erro).toBeNull();
    const mapa = Object.fromEntries(t.linhas.map((x) => [x.variant_id, x.tipo]));
    expect(mapa[vBracelete]).toBe("pulseira");
    expect(mapa[vBrinco]).toBe("brinco");
    const negado = await ler(rep, `select * from public.variantes_tipo_peca($1::uuid[])`, [`{${vBracelete}}`]);
    expect(negado.erro).toContain("Sem permissão");
  });

  test("bipa, confere e expede; o estoque sai do depósito", async () => {
    expect((await rpc(colab, "kit_item_upsert", { _cycle: ciclo, _variant: vBracelete, _qty: 6 })).erro).toBeNull();
    expect((await rpc(colab, "kit_item_upsert", { _cycle: ciclo, _variant: vBrinco, _qty: 20 })).erro).toBeNull();
    expect((await rpc(colab, "kit_conferir", { _cycle: ciclo, _note: null })).erro).toBeNull();
    expect((await rpc(colab, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } })).erro).toBeNull();
    expect((await um<{ q: number }>(`select quantity q from public.stock_balances where variant_id=$1 and location_id=$2`, [vBracelete, deposito])).q).toBe(24);
  });
});

describe("3. consultora recebe; cockpit e representante enxergam", () => {
  test("Ana ganha login, confirma a entrega e aceita", async () => {
    consultoraLogin = await criarConta({ nome: `1a-ana-${base}`, papeis: ["consultora"] });
    await adm.begin(async (tx) => {
      await tx.unsafe(`select set_config('lardan.profile_link','on',true)`);
      await tx.unsafe(`update public.profiles set party_id=$2 where id=$1`, [consultoraLogin.uid, ana]);
    });
    consultoraLogin = { ...consultoraLogin, partyId: ana };
    const t = (await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 order by seq limit 1`, [ciclo])).id;
    expect((await rpc(consultoraLogin, "kit_transfer_confirm", { _transfer: t, _payload: {} })).erro).toBeNull();
    const ace = await rpc(consultoraLogin, "kit_aceitar", {
      _cycle: ciclo, _idempotency_key: `1a-${base}-aceite`,
      _itens: [{ variant_id: vBracelete, qty_accepted: 6, qty_divergent: 0 }, { variant_id: vBrinco, qty_accepted: 20, qty_divergent: 0 }],
    });
    expect(ace.erro).toBeNull();
  });

  test("cockpit mostra o histórico SmallData e a maleta nova juntos; vitrine dela tem as peças", async () => {
    const v = await rpc<{ lardan: { cycle_id: string; motivo_invisivel: string | null }[]; smalldata: unknown[] }>(
      master, "consultora_maletas", { _party: ana });
    expect(v.erro).toBeNull();
    expect(v.dados.lardan.find((x) => x.cycle_id === ciclo)!.motivo_invisivel).toBeNull();
    expect((v.dados as unknown as { pessoa: { codigos_smalldata: number[] } }).pessoa.codigos_smalldata).toContain(ANA);
    const pecas = await ler(consultoraLogin, `select * from public.consultant_pieces()`);
    expect(JSON.stringify(pecas.linhas)).toContain(vBracelete);
  });

  test("0136: maleta aceita reativa a consultora que estava inativa pelo tempo sem maleta", async () => {
    const st = await um<{ p: string; r: string }>(
      `select p.status::text p, pr.status::text r from public.parties p join public.party_roles pr on pr.party_id=p.id and pr.role='consultora' where p.id=$1`, [ana]);
    expect(st).toEqual({ p: "ativo", r: "ativo" });
  });

  test("0136: consultora bloqueada não recebe maleta nova", async () => {
    const bia = (await um<{ p: string }>(`select party_id::text p from public.legado_consultoras where codcli=$1`, [BIA])).p;
    await adm.unsafe(`update public.consultant_profiles set praca_id=$2 where party_id=$1`, [bia, praca]);
    await adm.unsafe(`update public.parties set status='bloqueado' where id=$1`, [bia]);
    const r = await rpc(colab, "remessa_abrir_maleta", { _remessa: remessa, _consultora: bia });
    expect(r.erro).toContain("bloqueado");
  });

  test("representante vê a maleta e a consultora na carteira", async () => {
    expect((await ler(rep, `select id from public.kit_cycles where id=$1`, [ciclo])).linhas.length).toBe(1);
  });
});

describe("4. login por código endurecido e porta da Operação", () => {
  test("0136: tentativa é reservada de forma atômica — 5 em paralelo travam a 6ª, sucesso zera", async () => {
    const tent = await Promise.all(Array.from({ length: 8 }, () => rpcServico<string | null>("colab_login_reservar", { _codigo: codColab })));
    const liberadas = tent.filter((t) => t.erro === null && t.dados).length;
    expect(liberadas).toBe(5);
    expect((await rpcServico<string | null>("colab_login_reservar", { _codigo: codColab })).dados).toBeNull();
    expect((await rpcServico<string | null>("colab_login_reservar", { _codigo: "99999999" })).dados).toBeNull();
    await adm.unsafe(`update public.colab_acessos set bloqueado_ate = now() - interval '1 minute' where codigo=$1`, [codColab]);
    expect((await rpcServico<string | null>("colab_login_reservar", { _codigo: codColab })).dados).toBe(colab.uid);
    expect((await rpcServico("colab_login_ok", { _user: colab.uid })).erro).toBeNull();
    expect((await um<{ f: number }>(`select falhas f from public.colab_acessos where codigo=$1`, [codColab])).f).toBe(0);
    expect((await rpc(colab, "colab_login_reservar", { _codigo: codColab })).ok).toBe(false);
  });

  test("0136: código não vai para conta com papel de equipe (diretoria, master…)", async () => {
    const r = await rpcServico("colab_acesso_registrar", { _user_id: diretora.uid, _party_id: diretora.partyId, _codigo: codColab2, _actor: master.uid });
    expect(r.erro).toContain("papel de equipe");
  });

  test("0136: porta da Operação — consultora e representante não entram; colaboradora entra", async () => {
    const eu = async (c: Conta) => (await rpc<boolean>(c, "meu_acesso_colab", {})).dados;
    expect(await eu(colab)).toBe(true);
    expect(await eu(consultoraLogin)).toBe(false);
    expect(await eu(rep)).toBe(false);
    expect(portaLiberada("operacao", ["consultora"] as never, ["kit.view", "kit.accept"], false)).toBe(false);
    expect(portaLiberada("operacao", ["representante"] as never, ["kit.view", "kit.receive"], false)).toBe(false);
    expect(portaLiberada("operacao", [] as never, ["kit.view", "kit.manage"], true)).toBe(true);
    expect(portaLiberada("operacao", ["montagem"] as never, [], false)).toBe(true);
  });
});
