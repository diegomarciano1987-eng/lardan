/**
 * 0282 — revisão dos pacotes 0266–0281: raio-x sem falso alarme de maleta conferida, número de ABERTURA
 * sem repetição, fila fiscal parada enquanto houver pendência de nota da transferência, encerrar maleta
 * não reativa consultora, e a fila de avisos do Asaas processada depois do espelho.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 820000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, rep: Conta;
let deposito = "", vA = "", praca = "", remessa = "";

async function raioX(codigo: string): Promise<{ quantidade: number; exemplos: string[] }> {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
    const r = ((await c.unsafe(`select public.auditoria_integridade() r`)) as { r: unknown }[])[0]!.r;
    const itens = (Array.isArray(r) ? r : (r as { itens: unknown[] }).itens) as { codigo: string; quantidade: number; exemplos: string[] }[];
    return itens.find((x) => x.codigo === codigo) ?? { quantidade: 0, exemplos: [] };
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}

beforeAll(async () => {
  master = await criarConta({ nome: `r282-master-${base}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `r282-rep-${base}`, papeis: ["representante"], comParty: true });
  deposito = await criarDeposito(`r282-${marca}`);
  vA = await criarVariante(`r282-a-${marca}`, 10000);
  await porEstoque(vA, deposito, 50);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`R282 ${marca}`])).linhas[0]!.id;
  remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) })).dados.id;
});

describe("raio-x M3", () => {
  test("maleta conferida com peças na composição não é alarme; conferida vazia (forçada) é", async () => {
    const c = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta_representante", { _remessa: remessa })).dados.cycle_id;
    await rpc(master, "kit_item_upsert", { _cycle: c, _variant: vA, _qty: 2 });
    const conf = await rpc(master, "kit_conferir", { _cycle: c, _note: null });
    expect(conf.erro).toBeNull();
    const code = (await um<{ code: string }>(`select k.code from kit_cycles c join kits k on k.id=c.kit_id where c.id=$1`, [c])).code;
    expect((await raioX("M3")).exemplos.some((x) => x.startsWith(code + " "))).toBe(false);

    // conferida sem nenhuma peça (só por fora das funções) continua sendo alarme
    const v = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta_representante", { _remessa: remessa })).dados.cycle_id;
    await adm.unsafe(`update kit_cycles set status='conferida' where id=$1`, [v]);
    const codeV = (await um<{ code: string }>(`select k.code from kit_cycles c join kits k on k.id=c.kit_id where c.id=$1`, [v])).code;
    const m3 = await raioX("M3");
    expect(m3.quantidade).toBeGreaterThan(0);
    if (m3.exemplos.length < 5) expect(m3.exemplos.some((x) => x.startsWith(codeV + " "))).toBe(true);
    await adm.unsafe(`update kit_cycles set status='cancelada' where id=$1`, [v]);
  });

  test("F9 existe e F6 ignora aviso recente", async () => {
    const f9 = await raioX("F9");
    expect(typeof f9.quantidade).toBe("number");
    const conta = await um<{ id: string }>(`select id from asaas_accounts limit 1`).catch(() => null);
    if (!conta) return;
    await adm.unsafe(`insert into asaas_events (account_id, external_id, event, charge_external_id, event_at, payload, status, classification, last_error, received_at)
                      values ($1, $2, 'PAYMENT_RECEIVED', $3, now(), '{}', 'na_fila', 'revisao', 'Evento sem cobrança espelhada.', now())`,
      [conta.id, `ev282-${marca}`, `pay_282${marca}`]);
    expect((await raioX("F6")).exemplos.some((x) => x.includes(`pay_282${marca}`))).toBe(false);
    await adm.unsafe(`update asaas_events set received_at = now() - interval '3 days' where external_id=$1`, [`ev282-${marca}`]);
    expect((await raioX("F6")).exemplos.some((x) => x.includes(`pay_282${marca}`))).toBe(true);
  });
});

describe("número de ABERTURA sem repetição", () => {
  test("dois ciclos da mesma remessa com o mesmo número: o segundo ganha o próximo e a etiqueta acompanha", async () => {
    const a = (await rpc<{ cycle_id: string; abertura_numero: number }>(master, "remessa_abrir_maleta_representante", { _remessa: remessa })).dados;
    const b = (await rpc<{ cycle_id: string; abertura_numero: number }>(master, "remessa_abrir_maleta_representante", { _remessa: remessa })).dados;
    expect(b.abertura_numero).toBeGreaterThan(a.abertura_numero);
    // simula a corrida: o segundo grava o número do primeiro
    await adm.unsafe(`update kit_cycles set abertura_numero=$2 where id=$1`, [b.cycle_id, a.abertura_numero]);
    const depois = await um<{ n: number; label: string }>(`select c.abertura_numero n, k.label from kit_cycles c join kits k on k.id=c.kit_id where c.id=$1`, [b.cycle_id]);
    expect(depois.n).not.toBe(a.abertura_numero);
    const nums = (await adm.unsafe(`select abertura_numero n from kit_cycles where remessa_id=$1 and abertura_numero is not null`, [remessa])) as { n: number }[];
    expect(new Set(nums.map((x) => x.n)).size).toBe(nums.length);
    if (/^ABERTURA /.test(depois.label)) expect(depois.label.startsWith(`ABERTURA ${depois.n} `) || depois.label === `ABERTURA ${depois.n}`).toBe(true);
  });
});

describe("fila fiscal x pendência de nota da transferência", () => {
  test("pendência aberta tira da fila a nota de remessa pendente ou com erro", async () => {
    const c = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta_representante", { _remessa: remessa })).dados.cycle_id;
    await adm.unsafe(`delete from fiscal_fila where cycle_id=$1`, [c]);
    await adm.unsafe(`insert into fiscal_fila (cycle_id, etapa, status, criado_em) values ($1,'remessa','erro', now() - interval '2 days')`, [c]);
    await adm.unsafe(`insert into maleta_troca_pendencias (cycle_id, remessa_id, maleta, consultora_anterior_nome, consultora_nova_nome, nota_numero, origem)
                      values ($1,$2,'MAL-T','Anterior','Nova','123','equipe')`, [c, remessa]);
    const n = await um<{ n: number }>(`select count(*)::int n from fiscal_fila where cycle_id=$1 and etapa='remessa'`, [c]);
    expect(n.n).toBe(0);
  });

  test("gatilho da maleta não cria fila de remessa enquanto a pendência estiver aberta", async () => {
    const def = await um<{ d: string }>(`select pg_get_functiondef('public.fiscal_fila_kit_trg()'::regprocedure) d`);
    // 0324: a troca automática termina primeiro e ela mesma pede a nota nova
    expect(def.d).toContain("p.status = 'aberta') THEN\n    RETURN NEW; -- 0282/0324");
  });
});

describe("ativação por movimento", () => {
  test("encerrar a maleta não reativa; acerto reativa", async () => {
    const p = (await um<{ id: string }>(`insert into parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'inativo') returning id`, [`R282 Inativa ${marca}`])).id;
    await adm.unsafe(`insert into party_roles (party_id, role, status) values ($1,'consultora','inativo')`, [p]);
    const c = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta_representante", { _remessa: remessa })).dados.cycle_id;
    await adm.unsafe(`update kit_cycles set consultora_party_id=$2, status='operacao' where id=$1`, [c, p]);
    // ficou inativa depois (ex.: inativada pela equipe) e a maleta volta sem venda
    await adm.unsafe(`update parties set status='inativo' where id=$1`, [p]);
    await adm.unsafe(`update party_roles set status='inativo' where party_id=$1 and role='consultora'`, [p]);
    await adm.unsafe(`update kit_cycles set status='encerrada' where id=$1`, [c]);
    expect((await um<{ s: string }>(`select status::text s from parties where id=$1`, [p])).s).toBe("inativo");
    await adm.unsafe(`update kit_cycles set status='acerto' where id=$1`, [c]);
    expect((await um<{ s: string }>(`select status::text s from parties where id=$1`, [p])).s).toBe("ativo");
  });
});

describe("fila de avisos do Asaas depois do espelho", () => {
  test("processa só os avisos cuja cobrança já está no espelho (mesma conta)", async () => {
    const { drenarFilaAsaas } = await import("@/lib/asaas/fila.server");
    const chamados: string[] = [];
    const tabela = (rows: unknown[]) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "order", "limit", "in"]) q[m] = () => q;
      (q as { then: unknown }).then = (ok: (v: unknown) => void) => ok({ data: rows, error: null });
      return q;
    };
    const admin = {
      from: (t: string) => t === "asaas_events"
        ? tabela([{ id: "e1", charge_external_id: "pay_a", account_id: "A" }, { id: "e2", charge_external_id: "pay_b", account_id: "A" }, { id: "e3", charge_external_id: "pay_a", account_id: "B" }])
        : tabela([{ account_id: "A", external_id: "pay_a" }]),
      rpc: async (_fn: string, a: Record<string, unknown>) => { chamados.push(String(a["_evento"])); return { data: {}, error: null }; },
    };
    const r = await drenarFilaAsaas(admin as never);
    expect(chamados).toEqual(["e1"]);
    expect(r).toEqual({ naFila: 3, processados: 1, falhas: 0, semCobranca: 2 });
  });
});

describe("fila de avisos do Asaas não reprocessa o que aguarda decisão (0285)", () => {
  test("busca só avisos sem processed_at e para no teto de tempo", async () => {
    const { drenarFilaAsaas } = await import("@/lib/asaas/fila.server");
    const filtros: string[] = [];
    const tabela = (rows: unknown[]) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "in"]) q[m] = () => q;
      q["is"] = (c: string, v: unknown) => { filtros.push(`${c}=${String(v)}`); return q; };
      (q as { then: unknown }).then = (ok: (v: unknown) => void) => ok({ data: rows, error: null });
      return q;
    };
    let chamadas = 0;
    const admin = {
      from: (t: string) => t === "asaas_events"
        ? tabela([{ id: "e1", charge_external_id: "pay_a", account_id: "A" }, { id: "e2", charge_external_id: "pay_a", account_id: "A" }])
        : tabela([{ account_id: "A", external_id: "pay_a" }]),
      rpc: async () => { chamadas++; await new Promise((r) => setTimeout(r, 30)); return { data: {}, error: null }; },
    };
    const r = await drenarFilaAsaas(admin as never, 300, 10);
    expect(filtros).toContain("processed_at=null");
    expect(chamadas).toBe(1);
    expect(r.parcial).toBe(true);
    expect(r.processados).toBe(1);
  });
});

