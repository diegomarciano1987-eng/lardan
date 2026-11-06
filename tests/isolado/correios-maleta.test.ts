/**
 * 0236 — maleta pelos Correios. Banco ISOLADO, dados sintéticos, sem rede (a API não é chamada).
 *  1. Dados do envio: endereço, valor declarado = custo das peças, pendências.
 *  2. Débito vencido bloqueia a ida; só o Master libera, com motivo registrado.
 *  3. Um envio vivo por maleta e sentido; erro libera nova tentativa.
 *  4. Rastreio: entregue → os 30 dias de venda contam da entrega.
 *  5. Volta só com acerto fechado; código enviado → 5 dias; atraso vira alerta.
 *  6. Permissões: consultora não vê nada; funções de servidor não abrem para o Master.
 *  7. Corpo da pré-postagem (PAC 03298, reverso 03301, valor declarado 064).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, rpc, type Conta } from "./base";
import { corpoPrePostagem, SERVICO, type EnderecoCorreios } from "../../src/lib/correios/api.server";

let master: Conta, montagem: Conta, consultora: Conta, diretoria: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
let emissorAntes: string | null = null, emissor: string, emissorParty: string, plano: string;

async function servico<T>(sql: string, p: unknown[] = []): Promise<{ dados: T | null; erro: string | null }> {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
    return { dados: ((await c.unsafe(sql, p)) as { r: T }[])[0]!.r, erro: null };
  } catch (e) {
    return { dados: null, erro: (e as Error).message };
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}
async function endereco(party: string, cep = "86200055") {
  await adm.unsafe(`insert into public.party_addresses (party_id, postal_code, street, street_number, district, city, uf, is_primary)
                    values ($1,$2,'Rua das Flores','123','Centro','Ibiporã','PR',true)`, [party, cep]);
}
async function maleta(status: string, custo = 1500, qtd = 4) {
  const cons = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status, doc) values ('pessoa',$1,$1,'ativo','52998224725') returning id`, [`ISO Cons ${marca()}`]);
  await endereco(cons.id, "15520011");
  await adm.unsafe(`insert into public.contact_points (party_id, kind, value, is_primary) values ($1,'whatsapp','43999990000',true), ($1,'email','iso@exemplo.com',false)`, [cons.id]);
  const kit = await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO MAL ${marca()}`]);
  const ciclo = await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, status, consultora_party_id) values ($1,1,$2::kit_status,$3) returning id`, [kit.id, status, cons.id]);
  const comp = await um<{ id: string }>(`insert into public.kit_compositions (cycle_id, version) values ($1,1) returning id`, [ciclo.id]);
  const v = await criarVariante(`ISO-COR-${marca()}`);
  await adm.unsafe(`update public.product_variants set finished_piece_cost_cents = $2 where id = $1`, [v, custo]);
  await adm.unsafe(`insert into public.kit_composition_items (composition_id, variant_id, quantity) values ($1,$2,$3)`, [comp.id, v, qtd]);
  return { ciclo: ciclo.id, party: cons.id };
}
const abrir = (ciclo: string, direcao: string, ator: string | null, liberar: string | null = null) =>
  servico<string>(`select public.correios_envio_abrir($1,$2,'homologacao',$3,1000,'{}'::jsonb,$4,$5)::text r`,
    [ciclo, direcao, direcao === "ida" ? "03298" : "03301", ator, liberar]);
const resultado = (id: string, ok: boolean, codigo: string | null) =>
  servico(`select public.correios_envio_resultado($1,$2,'{}'::jsonb,$3,'pp1',2594,7,$4) r`, [id, ok, codigo, ok ? null : "recusado"]);

beforeAll(async () => {
  master = await criarConta({ nome: `cor-master-${marca()}`, papeis: ["master"], comParty: true });
  montagem = await criarConta({ nome: `cor-mont-${marca()}`, papeis: ["montagem"], comParty: true });
  consultora = await criarConta({ nome: `cor-cons-${marca()}`, papeis: ["consultora"], comParty: true });
  diretoria = await criarConta({ nome: `cor-dir-${marca()}`, papeis: ["diretoria"], comParty: true });
  const p = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status, doc) values ('organizacao','Lardan ISO','Lardan ISO','ativo','43319208000180') returning id`);
  await endereco(p.id);
  emissor = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name, party_id) values ('Lardan ISO','Lardan ISO',$1) returning id`, [p.id])).id;
  emissorAntes = (await um<{ e: string | null }>(`select emitter_entity_id::text e from public.fiscal_settings limit 1`))?.e ?? null;
  await adm.unsafe(`update public.fiscal_settings set emitter_entity_id = $1`, [emissor]);
  plano = (await um<{ id: string }>(`insert into public.chart_of_accounts (codigo, nome, natureza) values ($1,$1,'receita') returning id`, [`ISO-COR-${marca()}`])).id;
});
afterAll(async () => {
  await adm.unsafe(`update public.fiscal_settings set emitter_entity_id = $1`, [emissorAntes]);
});

describe("1 a 3. ida", () => {
  test("dados: valor declarado = custo × quantidade; endereço da consultora; sem pendência", async () => {
    const m = await maleta("conferida", 1500, 4);
    const r = await rpc<{ valor_declarado_cents: number; pendencias: string[]; destinatario: { cep: string; nome: string }; remetente: { doc: string } }>(
      montagem, "correios_maleta_dados", { _cycle: m.ciclo, _direcao: "ida" });
    expect(r.erro).toBeNull();
    expect(r.dados.valor_declarado_cents).toBe(6000);
    expect(r.dados.destinatario.cep).toBe("15520011");
    expect(r.dados.remetente.doc).toBe("43319208000180");
    expect(r.dados.pendencias).toEqual([]);
    expect((await rpc(montagem, "correios_maleta_dados", { _cycle: (await maleta("montagem")).ciclo, _direcao: "ida" })).erro).toContain("conferida");
  });

  test("débito vencido bloqueia; só Daniel (diretoria) ou Master libera, com motivo", async () => {
    const m = await maleta("conferida");
    const t = await rpc<string>(master, "fin_title_create", { _payload: { direction: "receivable", party_id: m.party, descricao: "ISO débito",
      valor_cents: 18125, emissao: "2026-09-01", competencia: "2026-09-01", business_entity_id: emissor, chart_account_id: plano,
      parcelas: [{ vencimento: "2026-09-10", valor_cents: 18125 }] } });
    expect(t.erro).toBeNull();
    expect((await abrir(m.ciclo, "ida", master.uid)).erro).toContain("débito vencido");
    expect((await abrir(m.ciclo, "ida", montagem.uid, "acordo")).erro).toContain("Só o Daniel (diretoria) ou o Master");
    const ok = await abrir(m.ciclo, "ida", master.uid, "Acordo assinado em 05/11");
    expect(ok.erro).toBeNull();
    const e = await um<{ debito_cents: string; debito_liberado_motivo: string }>(`select debito_cents, debito_liberado_motivo from public.correios_envios where id = $1`, [ok.dados]);
    expect(Number(e.debito_cents)).toBe(18125);
    expect(e.debito_liberado_motivo).toBe("Acordo assinado em 05/11");
    // a diretoria (Daniel) também libera
    const m2 = await maleta("conferida");
    await rpc(master, "fin_title_create", { _payload: { direction: "receivable", party_id: m2.party, descricao: "ISO débito 2",
      valor_cents: 5000, emissao: "2026-09-01", competencia: "2026-09-01", business_entity_id: emissor, chart_account_id: plano,
      parcelas: [{ vencimento: "2026-09-10", valor_cents: 5000 }] } });
    expect((await abrir(m2.ciclo, "ida", diretoria.uid, "Daniel autorizou")).erro).toBeNull();
  });

  test("um envio vivo por maleta; erro libera nova tentativa", async () => {
    const m = await maleta("conferida");
    const a = await abrir(m.ciclo, "ida", montagem.uid);
    expect(a.erro).toBeNull();
    expect((await abrir(m.ciclo, "ida", montagem.uid)).erro).toContain("já tem envio");
    expect((await resultado(a.dados!, false, null)).erro).toBeNull();
    const b = await abrir(m.ciclo, "ida", montagem.uid);
    expect(b.erro).toBeNull();
    expect((await resultado(b.dados!, true, `AA${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}BR`)).erro).toBeNull();
    const e = await um<{ status: string; frete_cents: string; previsto_entrega: string | null }>(`select status, frete_cents, previsto_entrega::text from public.correios_envios where id = $1`, [b.dados]);
    expect(e.status).toBe("pre_postada");
    expect(Number(e.frete_cents)).toBe(2594);
    expect(e.previsto_entrega).not.toBeNull();
  });
});

describe("4. rastreio", () => {
  test("postado e entregue: 30 dias de venda contam da entrega", async () => {
    const m = await maleta("expedida");
    const a = await abrir(m.ciclo, "ida", montagem.uid);
    await resultado(a.dados!, true, `AB${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}BR`);
    const eventos = [
      { codigo: "BDE", tipo: "01", dtHrCriado: "2026-11-12T14:30:00", descricao: "Objeto entregue ao destinatário" },
      { codigo: "RO", tipo: "01", dtHrCriado: "2026-11-07T08:00:00", descricao: "Objeto em transferência" },
      { codigo: "PO", tipo: "01", dtHrCriado: "2026-11-06T10:00:00", descricao: "Objeto postado" },
    ];
    const r = await servico<{ status: string }>(`select public.correios_envio_rastro($1,$2::text::jsonb) r`, [a.dados, JSON.stringify(eventos)]);
    expect(r.erro).toBeNull();
    expect(r.dados!.status).toBe("entregue");
    const c = await um<{ due: string }>(`select to_char(due_at at time zone 'America/Sao_Paulo','YYYY-MM-DD HH24:MI') due from public.kit_cycles where id = $1`, [m.ciclo]);
    expect(c.due).toBe("2026-12-12 14:30");
  });
});

describe("5. volta", () => {
  test("só com acerto fechado; código enviado conta 5 dias; atraso vira alerta", async () => {
    const aberta = await maleta("operacao");
    expect((await rpc(montagem, "correios_maleta_dados", { _cycle: aberta.ciclo, _direcao: "volta" })).erro).toContain("acerto fechado");
    const m = await maleta("encerrada");
    const d = await rpc<{ remetente: { cep: string }; destinatario: { doc: string }; pendencias: string[] }>(montagem, "correios_maleta_dados", { _cycle: m.ciclo, _direcao: "volta" });
    expect(d.erro).toBeNull();
    expect(d.dados.remetente.cep).toBe("15520011");            // na reversa, quem posta é a consultora
    expect(d.dados.destinatario.doc).toBe("43319208000180");
    // consultora sem e-mail: a reversa usa o e-mail da Lardan (Daniel, 05/11)
    const semEmail = await maleta("encerrada");
    await adm.unsafe(`delete from public.contact_points where party_id = $1 and kind = 'email'`, [semEmail.party]);
    const se = await rpc<{ remetente: { email: string }; pendencias: string[] }>(montagem, "correios_maleta_dados", { _cycle: semEmail.ciclo, _direcao: "volta" });
    expect(se.dados.remetente.email).toBe("lardansemijoias@gmail.com");
    expect(se.dados.pendencias).toEqual([]);
    const a = await abrir(m.ciclo, "volta", montagem.uid);
    expect(a.erro).toBeNull();
    await resultado(a.dados!, true, `AC${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}BR`);
    const enviado = await rpc<{ limite_postagem: string }>(montagem, "correios_volta_codigo_enviado", { _id: a.dados });
    expect(enviado.erro).toBeNull();
    const hoje = (await um<{ d: string }>(`select ((now() at time zone 'America/Sao_Paulo')::date + 5)::text d`)).d;
    expect(enviado.dados.limite_postagem).toBe(hoje);
    await adm.unsafe(`update public.correios_envios set limite_postagem = limite_postagem - 7 where id = $1`, [a.dados]);
    const p = await rpc<{ alertas_volta: { id: string; dias_atraso: number }[] }>(montagem, "correios_painel", { _cycle: m.ciclo });
    expect(p.erro).toBeNull();
    expect(p.dados.alertas_volta.map((x) => x.id)).toEqual([a.dados]);
    expect(p.dados.alertas_volta[0]!.dias_atraso).toBe(2);
  });
});

describe("6. permissões", () => {
  test("consultora não vê; servidor só como servidor", async () => {
    const m = await maleta("conferida");
    expect((await rpc(consultora, "correios_maleta_dados", { _cycle: m.ciclo, _direcao: "ida" })).ok).toBe(false);
    expect((await rpc(consultora, "correios_painel", {})).ok).toBe(false);
    expect((await rpc(master, "correios_envio_abrir", { _cycle: m.ciclo, _direcao: "ida", _ambiente: "homologacao", _servico: "03298",
      _valor_cents: 1, _payload: {}, _ator: master.uid, _liberar_debito: null })).ok).toBe(false);
    expect((await rpc(master, "correios_endereco", { _party: m.party })).ok).toBe(false);
  });
});

describe("7. corpo da pré-postagem", () => {
  const end = (nome: string, cep: string): EnderecoCorreios => ({ nome, doc: "52998224725", email: "a@b.com", ddd: "43", celular: "999990000", telefone: null,
    cep, logradouro: "Rua com um nome bem comprido que passa de cinquenta caracteres no total", numero: "123", complemento: null, bairro: "Centro", cidade: "Ibiporã", uf: "pr" });
  test("ida PAC com valor declarado; volta reversa", () => {
    const ida = corpoPrePostagem({ direcao: "ida", remetente: end("Lardan", "86200055"), destinatario: end("Amanda Seixas", "15520011"), valorDeclaradoCents: 182120, referencia: "Maleta MAL-00326 ida" });
    expect(ida.codigoServico).toBe(SERVICO.PAC_IDA);
    expect(ida.listaServicoAdicional).toEqual([{ codigoServicoAdicional: "064", valorDeclarado: "1821.20" }]);
    expect(ida.pesoInformado).toBe("1000");
    expect([ida.comprimentoInformado, ida.larguraInformada, ida.alturaInformada]).toEqual(["40", "30", "10"]);
    expect(ida.destinatario.endereco.logradouro.length).toBeLessThanOrEqual(50);
    expect(ida.destinatario.endereco.uf).toBe("PR");
    expect("logisticaReversa" in ida).toBe(false);
    const volta = corpoPrePostagem({ direcao: "volta", remetente: end("Amanda Seixas", "15520011"), destinatario: end("Lardan", "86200055"), valorDeclaradoCents: 0, referencia: "volta" });
    expect(volta.codigoServico).toBe(SERVICO.PAC_REVERSO);
    expect(volta.logisticaReversa).toBe("S");
    expect(volta.dataValidadeLogReversa).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect("listaServicoAdicional" in volta).toBe(false);
  });
});

describe("8. envio e entrega automáticos pelo rastreio (0247)", () => {
  test("postado → expedida; entregue → recebida (aguarda aceite) e 30 dias da entrega", async () => {
    const dep = await criarDeposito(`ISO COR ${marca()}`);
    const v = await criarVariante(`ISO-COR-AUTO-${marca()}`);
    await adm.unsafe(`update public.product_variants set finished_piece_cost_cents = 1200 where id = $1`, [v]);
    await porEstoque(v, dep, 5);
    const cons = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status, doc) values ('pessoa',$1,$1,'ativo','52998224725') returning id`, [`ISO Auto ${marca()}`]);
    await endereco(cons.id, "15520011");
    await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [cons.id]);
    const c = await rpc<{ cycle_id: string }>(master, "kit_cycle_create", { _payload: { origin_location_id: dep, consultora_party_id: cons.id } });
    expect(c.erro).toBeNull();
    const ciclo = c.dados.cycle_id;
    expect((await rpc(master, "kit_item_upsert", { _cycle: ciclo, _variant: v, _qty: 3 })).erro).toBeNull();
    expect((await rpc(master, "kit_conferir", { _cycle: ciclo, _note: null })).erro).toBeNull();
    const a = await abrir(ciclo, "ida", master.uid);
    expect(a.erro).toBeNull();
    await resultado(a.dados!, true, `AD${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}BR`);
    const postado = [{ codigo: "PO", tipo: "01", dtHrCriado: "2026-11-06T10:00:00", descricao: "Objeto postado" }];
    expect((await servico(`select public.correios_envio_rastro($1,$2::text::jsonb) r`, [a.dados, JSON.stringify(postado)])).erro).toBeNull();
    const k1 = await um<{ status: string }>(`select status::text from public.kit_cycles where id = $1`, [ciclo]);
    expect(["expedida", "transito"]).toContain(k1.status);
    const entregue = [{ codigo: "BDE", tipo: "01", dtHrCriado: "2026-11-10T15:00:00", descricao: "Objeto entregue ao destinatário" }, ...postado];
    expect((await servico(`select public.correios_envio_rastro($1,$2::text::jsonb) r`, [a.dados, JSON.stringify(entregue)])).erro).toBeNull();
    const k2 = await um<{ status: string; due: string }>(`select status::text, to_char(due_at at time zone 'America/Sao_Paulo','YYYY-MM-DD') due from public.kit_cycles where id = $1`, [ciclo]);
    const e = await um<{ auto_erro: string | null; auto_entregue: boolean }>(`select auto_erro, auto_entregue_em is not null auto_entregue from public.correios_envios where id = $1`, [a.dados]);
    expect(e.auto_erro).toBeNull();
    expect(e.auto_entregue).toBe(true);
    expect(k2.status).toBe("recebida");
    expect(k2.due).toBe("2026-12-10");
    // de novo, o mesmo rastreio não faz nada duas vezes
    expect((await servico(`select public.correios_envio_rastro($1,$2::text::jsonb) r`, [a.dados, JSON.stringify(entregue)])).erro).toBeNull();
  });
});
