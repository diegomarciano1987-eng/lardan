/**
 * 0402 — A Lara rodando: aviso da Meta (mensagem nova ou status) → roteiro → fila → envio.
 * A fila é a única porta de saída (idempotente, com novas tentativas). Desligada (lara_ativa = false):
 * as mensagens que chegam ficam gravadas, mas ninguém responde sozinho.
 */
import { decidir, juntar, ler, type Contexto, type Envio, type Estado } from "./roteiro";
import { TEXTO, linkTeste } from "./textos";

type Rpc = (f: string, a?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as { rpc: Rpc };
async function chamar<T>(f: string, a: Record<string, unknown> = {}): Promise<T> {
  const sb = await admin();
  const r = await sb.rpc(f, a);
  if (r.error) throw new Error(`${f}: ${r.error.message}`);
  return r.data as T;
}

type MsgMeta = {
  from: string; id: string; timestamp?: string; type: string;
  text?: { body?: string }; button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
};
type StatusMeta = { id: string; status: string; errors?: { code?: number; title?: string; message?: string }[] };
type Aviso = { entry?: { changes?: { field?: string; value?: { messages?: MsgMeta[]; statuses?: StatusMeta[] } }[] }[] };

function textoDe(m: MsgMeta): { texto: string; soMidia: boolean; tipo: string } {
  if (m.type === "text") return { texto: m.text?.body ?? "", soMidia: false, tipo: "texto" };
  if (m.type === "button") return { texto: m.button?.text ?? m.button?.payload ?? "", soMidia: false, tipo: "botao" };
  if (m.type === "interactive") return { texto: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "", soMidia: false, tipo: "botao" };
  return { texto: `[${m.type}]`, soMidia: true, tipo: m.type.slice(0, 30) };
}

const ETAPA: Record<string, string> = {
  nova: "a Lara perguntou como ela conheceu a Lardan e se tem interesse em revender no consignado",
  msg1: "a Lara perguntou como ela conheceu a Lardan e se tem interesse em revender no consignado",
  msg2: "a Lara explicou o consignado e perguntou 'Combinado?'",
  teste: "a Lara mandou o link do teste de perfil", lembrete: "a Lara lembrou do teste de perfil",
  recusada: "a Lara avisou que a candidatura não seguiu e ofereceu pedir revisão",
};

/** Processa o aviso inteiro da Meta. Nunca lança: o que falhar fica no log e a Meta não reenvia em loop. */
export async function tratarAviso(aviso: Aviso) {
  let novas = 0;
  for (const e of aviso.entry ?? []) {
    for (const ch of e.changes ?? []) {
      const v = ch.value ?? {};
      for (const s of v.statuses ?? []) {
        try {
          const err = s.errors?.[0];
          await chamar("lara_status", { _wamid: s.id, _status: s.status, _erro: err ? `${err.code ?? ""} ${err.title ?? err.message ?? ""}`.trim() : null });
        } catch (x) { console.error("[lara] status:", (x as Error).message); }
      }
      for (const m of v.messages ?? []) {
        try { await tratarMensagem(m); novas += 1; } catch (x) { console.error("[lara] mensagem:", (x as Error).message); }
      }
    }
  }
  if (novas) await processarFila(10).catch((x) => console.error("[lara] fila:", (x as Error).message));
  return { novas };
}

async function tratarMensagem(m: MsgMeta) {
  if (!/^\d{10,15}$/.test(m.from ?? "") || !m.id) return;
  const { texto, soMidia, tipo } = textoDe(m);
  const em = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
  const r = await chamar<{ duplicada: boolean; lead_id: string | null; estado?: Estado; humano?: boolean; opt_out?: boolean; nome?: string; teste_concluido?: boolean }>(
    "lara_entrada", { _wa_id: m.from, _wamid: m.id, _tipo: tipo, _texto: texto, _em: em });
  if (r.duplicada) return;
  const ativa = await chamar<boolean>("lara_ativa");
  const { marcarLida } = await import("./meta.server");
  void marcarLida(m.id);
  if (!ativa) return;

  if (!r.lead_id) {
    // número sem candidatura: uma resposta por dia, explicando como se candidatar
    const dia = new Date().toISOString().slice(0, 10);
    await chamar("lara_enfileirar", { _lead: null, _wa: m.from, _tipo: "texto", _conteudo: { texto: TEXTO.desconhecido() }, _registro: TEXTO.desconhecido(), _chave: `desconhecido:${m.from}:${dia}` });
    return;
  }

  let leitura = ler(soMidia ? "" : texto);
  if (!soMidia && !leitura.entendeu && !r.humano && !r.opt_out) {
    const { lerComIa } = await import("./ia.server");
    leitura = juntar(leitura, await lerComIa(texto, ETAPA[r.estado ?? ""] ?? "conversa de candidatura"));
  }
  const ctx: Contexto = { estado: r.estado ?? "msg1", humano: !!r.humano, optOut: !!r.opt_out, nome: r.nome ?? "", testeConcluido: !!r.teste_concluido, soMidia };
  const passo = decidir(ctx, leitura);

  for (const envio of passo.enviar) await enfileirar(r.lead_id, m.from, envio, ctx.nome);
  if (passo.revisao) await chamar("lara_revisao_pedir", { _lead: r.lead_id, _texto: texto });
  if (passo.estado || passo.humano || passo.comoConheceu || passo.optOut || passo.limparProxima || passo.proximaEmHoras) {
    await chamar("lara_transicao", {
      _lead: r.lead_id,
      _estado: passo.revisao ? null : passo.estado ?? null,
      _proxima_em: passo.proximaEmHoras ? new Date(Date.now() + passo.proximaEmHoras * 3600_000).toISOString() : null,
      _limpar_proxima: !!passo.limparProxima,
      _humano_motivo: passo.humano ?? null,
      _como_conheceu: passo.comoConheceu ?? null,
      _opt_out: !!passo.optOut,
    });
  }
}

async function enfileirar(lead: string, wa: string, e: Envio, nome: string) {
  if (e.tipo === "texto") {
    await chamar("lara_enfileirar", { _lead: lead, _wa: wa, _tipo: "texto", _conteudo: { texto: e.texto }, _registro: e.texto });
  } else if (e.tipo === "botoes") {
    await chamar("lara_enfileirar", { _lead: lead, _wa: wa, _tipo: "botoes", _conteudo: { texto: e.texto, botoes: e.botoes }, _registro: `${e.texto}\n[${e.botoes.join(" | ")}]` });
  } else {
    const token = await chamar<string>("lara_teste_token", { _lead: lead });
    const texto = e.modelo === "msg3" ? TEXTO.msg3(nome, linkTeste(token)) : TEXTO.linkDeNovo(nome, linkTeste(token));
    await chamar("lara_enfileirar", { _lead: lead, _wa: wa, _tipo: "texto", _conteudo: { texto }, _registro: texto });
  }
}

type ItemFila = { id: string; lead_id: string | null; wa_id: string; tipo: "template" | "texto" | "botoes"; conteudo: Record<string, unknown> };

/** Envia o que está na fila (até n por vez). Falha temporária volta em 2, 4, 6… minutos; definitiva vira "falhou". */
export async function processarFila(n = 20) {
  const meta = await import("./meta.server");
  const lista = await chamar<unknown[]>("lara_fila_pegar", { _n: n });
  const itens = (lista ?? []).map((x) => (x && typeof x === "object" && "lara_fila_pegar" in (x as object) ? (x as { lara_fila_pegar: ItemFila }).lara_fila_pegar : x)) as ItemFila[];
  let enviadas = 0;
  let falhas = 0;
  for (const it of itens) {
    try {
      const c = it.conteudo;
      let wamid = "";
      if (it.tipo === "template") wamid = await meta.enviarModelo(it.wa_id, String(c["template"]), (c["params"] as string[]) ?? [], (c["url"] as string | undefined) ?? null);
      else if (it.tipo === "botoes") wamid = await meta.enviarBotoes(it.wa_id, String(c["texto"]), (c["botoes"] as string[]) ?? []);
      else wamid = await meta.enviarTexto(it.wa_id, String(c["texto"]));
      await chamar("lara_fila_concluir", { _id: it.id, _wamid: wamid, _erro: null, _definitivo: false });
      enviadas += 1;
    } catch (e) {
      falhas += 1;
      const definitivo = e instanceof meta.ErroMeta ? e.definitivo : false;
      await chamar("lara_fila_concluir", { _id: it.id, _wamid: null, _erro: (e as Error).message.slice(0, 400), _definitivo: definitivo }).catch(() => undefined);
    }
  }
  return { enviadas, falhas };
}

/** Rotina de 1 minuto: lembrete do dia 2, expiração e fila. */
export async function rodarRotina() {
  const ativa = await chamar<boolean>("lara_ativa");
  const prazos = ativa ? await chamar<{ lembretes: number; expiradas: number }>("lara_prazos") : { lembretes: 0, expiradas: 0 };
  const fila = await processarFila(50);
  return { ...prazos, ...fila };
}
