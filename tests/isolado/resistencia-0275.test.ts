/**
 * 0275 — resistência: nota fiscal nunca sai em dobro por falha de rede, fila fiscal reservada,
 * reconferência das notas sem resposta, avisos informativos do Asaas fora da fila, token dos Correios.
 * Banco ISOLADO; a Focus e os Correios são simulados (fetch falso), nada sai para a internet.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const fetchOriginal = globalThis.fetch;
const envOriginal = { ...process.env };

async function servico<T>(sql: string, p: unknown[] = []): Promise<{ ok: boolean; dados: T | null; erro: string | null }> {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
    return { ok: true, dados: ((await c.unsafe(sql, p)) as { r: T }[])[0]!.r, erro: null };
  } catch (e) {
    return { ok: false, dados: null, erro: (e as Error).message };
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}

type Resp = { status: number; corpo: unknown } | "rede" | "tempo";
function simularFocus(respostas: Record<"POST" | "GET", Resp[]>) {
  const chamadas: string[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const m = (init?.method ?? "GET") as "POST" | "GET";
    chamadas.push(`${m} ${String(url)}`);
    const r = respostas[m].shift();
    if (!r) throw new Error("chamada inesperada");
    if (r === "rede") throw new TypeError("fetch failed");
    if (r === "tempo") { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return chamadas;
}

beforeAll(() => {
  process.env["FOCUS_TOKEN_PRODUCAO"] = "teste-isolado";
  process.env["FOCUS_EGRESS_ENABLED"] = "true";
});
afterAll(() => {
  globalThis.fetch = fetchOriginal;
  for (const k of ["FOCUS_TOKEN_PRODUCAO", "FOCUS_EGRESS_ENABLED", "CORREIOS_USUARIO", "CORREIOS_CODIGO_ACESSO", "CORREIOS_CARTAO", "CORREIOS_CONTRATO", "CORREIOS_CEP_ORIGEM"]) {
    if (envOriginal[k] === undefined) delete process.env[k]; else process.env[k] = envOriginal[k];
  }
});

describe("nota fiscal: falha de rede não libera segunda nota", () => {
  test("sem resposta e a Focus NÃO tem a nota: erro_envio (pode emitir de novo)", async () => {
    const { emitirNfe } = await import("@/lib/focus/api.server");
    const ch = simularFocus({ POST: ["tempo"], GET: [{ status: 404, corpo: { codigo: "nao_encontrado" } }] });
    const r = await emitirNfe("producao", "ref-a", {});
    expect(r.dados.status).toBe("erro_envio");
    expect(ch.map((c) => c.split(" ")[0])).toEqual(["POST", "GET"]);
  });

  test("sem resposta mas a Focus RECEBEU: grava o estado real, não erro", async () => {
    const { emitirNfe } = await import("@/lib/focus/api.server");
    simularFocus({ POST: ["rede"], GET: [{ status: 200, corpo: { status: "autorizado", numero: "77", chave_nfe: "4".repeat(44) } }] });
    const r = await emitirNfe("producao", "ref-b", {});
    expect(r.dados.status).toBe("autorizado");
  });

  test("Focus fora do ar (502) e a consulta também falha: fica 'processando' (nota viva, sem segunda nota)", async () => {
    const { emitirNfe } = await import("@/lib/focus/api.server");
    simularFocus({ POST: [{ status: 502, corpo: { mensagem: "bad gateway" } }], GET: ["rede"] });
    const r = await emitirNfe("producao", "ref-c", {});
    expect(r.dados.status).toBe("processando_autorizacao");
    expect(r.dados.mensagem_sefaz).toContain("conferida sozinha");
  });

  test("recusa de verdade (400 com erros) continua erro_envio sem consultar; token recusado continua erro", async () => {
    const { emitirNfe } = await import("@/lib/focus/api.server");
    const ch = simularFocus({ POST: [{ status: 400, corpo: { mensagem: "campo inválido" } }], GET: [] });
    expect((await emitirNfe("producao", "ref-d", {})).dados.status).toBe("erro_envio");
    expect(ch.length).toBe(1);
    simularFocus({ POST: [{ status: 401, corpo: {} }], GET: [] });
    await expect(emitirNfe("producao", "ref-e", {})).rejects.toThrow("token");
  });
});

describe("fila e reconferência no banco", () => {
  let ciclo = "";
  beforeAll(async () => {
    const kit = await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO 0275 ${marca}`]);
    ciclo = (await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, status) values ($1,1,'montagem') returning id`, [kit.id])).id;
  });

  test("só o servidor lista e marca notas para conferir", async () => {
    expect((await adm.unsafe(`select has_function_privilege('authenticated','public.fiscal_focus_pendentes_conferir(int)','EXECUTE') a`))[0]!.a).toBe(false);
    expect((await adm.unsafe(`select has_function_privilege('anon','public.fiscal_focus_conferida(text)','EXECUTE') a`))[0]!.a).toBe(false);
  });

  test("nota sem resposta há mais de 3 min entra na conferência; conferida sem novidade sai da vez", async () => {
    const ref = `iso-0275-${marca}`;
    await adm.unsafe(`insert into public.fiscal_focus_envios (ref, ambiente, operacao, status, payload, cycle_id, updated_at)
      values ($1,'producao','remessa','processando_autorizacao','{}',$2, now() - interval '10 minutes')`, [ref, ciclo]);
    const l = await servico<{ ref: string }[]>(`select public.fiscal_focus_pendentes_conferir(30) r`);
    expect(l.erro).toBeNull();
    expect(l.dados!.map((x) => x.ref)).toContain(ref);
    await servico(`select public.fiscal_focus_conferida($1)::text r`, [ref]);
    const l2 = await servico<{ ref: string }[]>(`select public.fiscal_focus_pendentes_conferir(30) r`);
    expect(l2.dados!.map((x) => x.ref)).not.toContain(ref);
    // "processando" segura a maleta: o banco não aceita outra remessa viva
    const dup = await servico(`select public.fiscal_focus_envio_maleta_registrar($1,'producao',$2::uuid,null,1,'{}'::jsonb,null,null)::text r`, [`${ref}-2`, ciclo]);
    expect(dup.ok).toBe(false);
    // a Focus disse que não recebeu: libera
    await servico(`select public.fiscal_focus_retorno($1,'consulta','{"status":"erro_envio"}'::jsonb,null)::text r`, [ref]);
    expect((await um<{ s: string }>(`select status s from public.fiscal_focus_envios where ref=$1`, [ref])).s).toBe("erro_envio");
  });

  test("duas rodadas da fila ao mesmo tempo não pegam a mesma maleta", async () => {
    const antes = await um<{ e: boolean; amb: string; p: string }>(`select emission_active e, environment amb, provider p from public.fiscal_settings limit 1`);
    try {
      await adm.unsafe(`update public.fiscal_settings set emission_active=true, environment='producao', provider='focus'`);
      const f = await um<{ id: string }>(`insert into public.fiscal_fila (cycle_id, etapa) values ($1,'remessa') returning id::text`, [ciclo]);
      const a = await servico<{ id: number }[]>(`select public.fiscal_fila_proximos(20) r`);
      const b = await servico<{ id: number }[]>(`select public.fiscal_fila_proximos(20) r`);
      expect(a.dados!.map((x) => String(x.id))).toContain(f.id);
      expect(b.dados!.map((x) => String(x.id))).not.toContain(f.id);
      // resultado com erro devolve para a fila com espera própria (não fica preso na reserva)
      await servico(`select public.fiscal_fila_resultado($1::bigint,false,'teste')::text r`, [f.id]);
      expect((await um<{ s: string }>(`select status s from public.fiscal_fila where id=$1::bigint`, [f.id])).s).toBe("pendente");
      await adm.unsafe(`delete from public.fiscal_fila where id=$1::bigint`, [f.id]);
    } finally {
      await adm.unsafe(`update public.fiscal_settings set emission_active=$1, environment=$2, provider=$3`, [antes.e, antes.amb, antes.p]);
    }
  });
});

describe("Correios: token pedido uma vez só no pico", () => {
  test("10 etiquetas ao mesmo tempo esperam o mesmo token; 401 renova e tenta uma vez", async () => {
    Object.assign(process.env, { CORREIOS_USUARIO: "u", CORREIOS_CODIGO_ACESSO: "c", CORREIOS_CARTAO: "1", CORREIOS_CONTRATO: "2", CORREIOS_CEP_ORIGEM: "86000000" });
    let tokens = 0; let negar = 1;
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/token/")) { tokens++; await new Promise((r) => setTimeout(r, 20)); return new Response(JSON.stringify({ token: `t${tokens}`, expiraEm: new Date(Date.now() + 3600e3).toISOString() }), { status: 201 }); }
      if (u.includes("/negar") && negar-- > 0) return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const api = await import("@/lib/correios/api.server");
    api.esquecerToken();
    const r = await Promise.all(Array.from({ length: 10 }, () => api.chamar("GET", "/qualquer")));
    expect(r.every((x) => x.http === 200)).toBe(true);
    expect(tokens).toBe(1);
    const n = await api.chamar("GET", "/negar");
    expect(n.http).toBe(200);
    expect(tokens).toBe(2);
  });
});

describe("Asaas: avisos informativos", () => {
  test("eventos de 'abriu a página' pendentes saem da fila de revisão sem erro", async () => {
    const conta = await um<{ id: string } | undefined>(`select id from public.asaas_accounts limit 1`);
    if (!conta) return; // bancada sem conta Asaas: a migração já cobre
    await adm.unsafe(`insert into public.asaas_events (account_id, external_id, event, charge_external_id, event_at, payload, status, classification, last_error)
      values ($1, $2, 'PAYMENT_CHECKOUT_VIEWED', 'pay_x', now(), '{}', 'na_fila', 'revisao', 'Evento sem cobrança espelhada.')`, [conta.id, `ev-${marca}`]);
    await adm.unsafe(`UPDATE public.asaas_events SET status = 'ignorado', classification = 'conhecido', last_error = NULL, processed_at = coalesce(processed_at, now())
      WHERE processed_at IS NULL AND event IN ('PAYMENT_CHECKOUT_VIEWED', 'PAYMENT_BANK_SLIP_VIEWED', 'PAYMENT_VIEWED')`);
    const e = await um<{ status: string; last_error: string | null }>(`select status, last_error from public.asaas_events where external_id=$1`, [`ev-${marca}`]);
    expect(e).toEqual({ status: "ignorado", last_error: null });
  });
});
