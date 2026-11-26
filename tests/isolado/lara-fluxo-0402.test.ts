/**
 * 0402 — A Lara de ponta a ponta no banco isolado: aviso da Meta → roteiro → fila → envio.
 * A Meta e a IA são simuladas (fetch interceptado); o banco é o de verdade, chamado como o servidor (service_role).
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { adm } from "./base";

// cliente do servidor → banco isolado como service_role
const SETOF = new Set(["lara_fila_pegar"]);
async function rpcBanco(fn: string, args: Record<string, unknown> = {}) {
  try {
    const nomes = Object.keys(args);
    const vals = nomes.map((k) => { const v = args[k]; return v !== null && typeof v === "object" ? JSON.stringify(v) : v; });
    // objeto vai como texto e vira jsonb no banco (igual ao que o PostgREST faz)
    const marcas = nomes.map((k, i) => (args[k] !== null && typeof args[k] === "object" ? `${k} => $${i + 1}::text::jsonb` : `${k} => $${i + 1}`));
    const linhas = (await adm.begin(async (tx) => {
      await tx.unsafe(`set local role service_role`);
      return tx.unsafe(`select x as r from public.${fn}(${marcas.join(", ")}) as x`, vals as never[]);
    })) as { r: unknown }[];
    return { data: SETOF.has(fn) ? linhas.map((l) => l.r) : (linhas[0]?.r ?? null), error: null };
  } catch (e) {
    return { data: null, error: { message: (e as Error).message } };
  }
}
mock.module(new URL("../../src/integrations/supabase/client.server.ts", import.meta.url).pathname, () => ({ supabaseAdmin: { rpc: rpcBanco } }));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: rpcBanco } }));

type Enviada = { to: string; type: string; corpo: Record<string, unknown> };
const enviadas: Enviada[] = [];
const fetchOriginal = globalThis.fetch;
let seqMeta = 0;

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const zap = `4398${String(1000000 + Math.floor(Math.random() * 8999999))}`;
const wa = `55${zap}`;
let leadId = "";
let fluxo: typeof import("../../src/lib/lara/fluxo.server");

function aviso(texto: string, tipo: "text" | "button" = "text") {
  seqMeta += 1;
  const msg = tipo === "text"
    ? { from: wa, id: `wamid.in.${marca}.${seqMeta}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: texto } }
    : { from: wa, id: `wamid.in.${marca}.${seqMeta}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "button", button: { text: texto, payload: texto } };
  return { entry: [{ changes: [{ field: "messages", value: { messages: [msg] } }] }] };
}
const ultima = () => enviadas[enviadas.length - 1]!;
const conversa = () => um<{ estado: string; humano: boolean; humano_motivo: string | null }>(`select estado, humano, humano_motivo from public.lara_conversas where lead_id=$1`, [leadId]);

beforeAll(async () => {
  process.env["WHATSAPP_TOKEN"] = "teste";
  process.env["WHATSAPP_PHONE_NUMBER_ID"] = "1390805127458885";
  process.env["WHATSAPP_WABA_ID"] = "1464697035038740";
  delete process.env["LOVABLE_API_KEY"]; // sem IA: o que a regra não entende vai para pessoa
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://graph.facebook.com/")) {
      const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (corpo["status"] === "read") return new Response(JSON.stringify({ success: true }), { status: 200 });
      enviadas.push({ to: String(corpo["to"]), type: String(corpo["type"]), corpo });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.out.${marca}.${enviadas.length}` }] }), { status: 200 });
    }
    throw new Error(`rede bloqueada no teste: ${u}`);
  }) as typeof fetch;
  await adm.unsafe(`insert into public.captacao_config (chave, valor) values ('lara_ativa', 'true'::jsonb) on conflict (chave) do update set valor = excluded.valor`);
  const st = await um<{ id: string }>(`select id from public.candidatura_stages where key='nova'`);
  leadId = (await um<{ id: string }>(
    `insert into public.leads (full_name, first_name, whatsapp, city, uf, privacy_version, stage_id, protocol, dream)
     values ($1,'ANA',$2,'Maringá','PR','v1',$3,$4,'Viajar com a família') returning id`, [`Ana Fluxo ${marca}`, zap, st.id, `CAP-${marca}-F`])).id;
  fluxo = await import("../../src/lib/lara/fluxo.server");
});
afterAll(async () => {
  globalThis.fetch = fetchOriginal;
  await adm.unsafe(`insert into public.captacao_config (chave, valor) values ('lara_ativa', 'false'::jsonb) on conflict (chave) do update set valor = excluded.valor`);
});

describe("0402: conversa completa", () => {
  test("mensagem 1 sai como modelo para o número dela", async () => {
    await rpcBanco("lara_iniciar", { _lead: leadId });
    const r = await fluxo.processarFila(50);
    expect(r.enviadas).toBeGreaterThanOrEqual(1);
    const m = enviadas.find((e) => e.to === wa)!;
    expect(m.type).toBe("template");
    expect((m.corpo["template"] as { name: string }).name).toBe("lara_candidatura_recebida");
    expect(JSON.stringify(m.corpo)).toContain("Viajar com a família");
  });

  test("'Sim, conheci pelo Instagram' → mensagem 2 com botões e como conheceu na ficha", async () => {
    await fluxo.tratarAviso(aviso("Sim! Conheci pelo Instagram"));
    expect(ultima().type).toBe("interactive");
    expect(JSON.stringify(ultima().corpo)).toContain("a maleta é consignada");
    expect((await conversa()).estado).toBe("msg2");
    expect((await um<{ c: string }>(`select como_conheceu c from public.leads where id=$1`, [leadId])).c).toBe("instagram");
  });

  test("'Combinado!' (botão) → mensagem 3 com o link do teste; etapa Teste; lembrete marcado para 48 h", async () => {
    await fluxo.tratarAviso(aviso("Combinado!", "button"));
    const corpo = JSON.stringify(ultima().corpo);
    expect(corpo).toMatch(/lardan\.com\.br\/candidatura\/[a-f0-9]{64}/);
    expect(corpo).toContain("Depois do teste, a gente faz uma consulta no seu CPF");
    expect((await conversa()).estado).toBe("teste");
    const p = await um<{ h: number }>(`select (extract(epoch from proxima_acao_em - now())/3600)::float8 h from public.lara_conversas where lead_id=$1`, [leadId]);
    expect(p.h).toBeGreaterThan(47);
  });

  test("'você é robô?' → diz que é a Lara, assistente de IA; o passo não muda", async () => {
    await fluxo.tratarAviso(aviso("vc é robô?"));
    expect(JSON.stringify(ultima().corpo)).toContain("assistente de IA");
    expect((await conversa()).estado).toBe("teste");
  });

  test("dúvida livre → passa para uma pessoa e a Lara fica quieta depois", async () => {
    await fluxo.tratarAviso(aviso("quanto tempo a maleta demora pra chegar?"));
    expect(JSON.stringify(ultima().corpo)).toContain("pessoa da nossa equipe");
    expect(await conversa()).toMatchObject({ humano: true, humano_motivo: "Dúvida sobre o teste" });
    const antes = enviadas.length;
    await fluxo.tratarAviso(aviso("oi?"));
    expect(enviadas.length).toBe(antes);
  });

  test("aviso repetido da Meta não gera resposta duplicada; status de leitura chega", async () => {
    await adm.unsafe(`update public.lara_conversas set humano=false, humano_motivo=null where lead_id=$1`, [leadId]);
    const a = aviso("me manda o link de novo");
    await fluxo.tratarAviso(a);
    const depois1 = enviadas.length;
    await fluxo.tratarAviso(a);
    expect(enviadas.length).toBe(depois1);
    const ultimoWamid = `wamid.out.${marca}.${enviadas.length}`;
    await fluxo.tratarAviso({ entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: ultimoWamid, status: "read" }] } }] }] } as never);
    expect((await um<{ s: string }>(`select status s from public.lara_mensagens where wa_message_id=$1`, [ultimoWamid])).s).toBe("lida");
  });

  test("Meta fora do ar: fica na fila e tenta de novo; erro definitivo vira 'falhou' sem repetir", async () => {
    const st = await um<{ id: string }>(`select id from public.candidatura_stages where key='nova'`);
    const z2 = `4398${String(1000000 + Math.floor(Math.random() * 8999999))}`;
    const l2 = (await um<{ id: string }>(`insert into public.leads (full_name, whatsapp, city, uf, privacy_version, stage_id, protocol, dream) values ($1,$2,'Londrina','PR','v1',$3,$4,'Carro') returning id`, [`Bia ${marca}`, z2, st.id, `CAP-${marca}-G`])).id;
    await rpcBanco("lara_iniciar", { _lead: l2 });
    const ok = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "Service unavailable", code: 2 } }), { status: 503 })) as unknown as typeof fetch;
    await fluxo.processarFila(50);
    let f = await um<{ tentativas: number; enviado_em: string | null; cancelado_em: string | null }>(`select tentativas, enviado_em, cancelado_em from public.lara_fila where lead_id=$1`, [l2]);
    expect(f).toMatchObject({ tentativas: 1, enviado_em: null, cancelado_em: null });
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "Message undeliverable", code: 131026 } }), { status: 400 })) as unknown as typeof fetch;
    await adm.unsafe(`update public.lara_fila set proxima_em = now() where lead_id=$1`, [l2]);
    await fluxo.processarFila(50);
    globalThis.fetch = ok;
    f = await um(`select tentativas, enviado_em, cancelado_em from public.lara_fila where lead_id=$1`, [l2]);
    expect(f.cancelado_em).not.toBeNull();
  });
});
