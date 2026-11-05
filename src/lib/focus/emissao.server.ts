/**
 * Emissão da NF-e da MALETA (remessa e notas do acerto) — somente servidor.
 * Usada pelo botão (com a sessão do Master) e pela fila automática (executor
 * interno, sem usuário). O AMBIENTE vem do banco (fiscal_focus_ambiente):
 * homologação até o Master ligar a produção em Integrações; depois, produção
 * para a maleta piloto ou para todas.
 */
import type { AmbienteNfe, DestinatarioNfe } from "./nfe";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export type ChamarRpc = <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;

export function rpcCom(cliente: { rpc: Rpc }): ChamarRpc {
  return async <T>(fn: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await cliente.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  };
}
export async function rpcServidor<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return rpcCom(supabaseAdmin as unknown as { rpc: Rpc })<T>(fn, args);
}

export interface Emitente { cnpj: string; uf: string }
export async function emitenteFiscal(rpc: ChamarRpc): Promise<Emitente> {
  const e = await rpc<{ cnpj?: string | null; uf?: string | null } | null>("fiscal_focus_emitente");
  const cnpj = (e?.cnpj && e.cnpj.length === 14 ? e.cnpj : process.env["FOCUS_CNPJ_EMITENTE"] ?? "").replace(/\D/g, "");
  const uf = (e?.uf ?? process.env["FOCUS_UF_EMITENTE"] ?? "PR").toUpperCase();
  if (cnpj.length !== 14) throw new Error("Defina o emissor (Integrações > Nota fiscal) ou o segredo FOCUS_CNPJ_EMITENTE.");
  return { cnpj, uf };
}

interface ItemBanco { variant_id?: string; codigo: string; descricao: string; ncm: string; quantidade: number; preco_varejo_cents: number; numero_item_origem?: number | null }
interface DadosMaleta {
  ambiente: AmbienteNfe;
  destinatario: DestinatarioNfe & { party_id: string };
  itens: (ItemBanco & { variant_id: string })[];
  pendencias: string[];
  composicao_versao: number;
  remessa: { numero: number | null; kit: number | null };
  nota_viva: { ref: string; status: string } | null;
}
export type OperacaoAcerto = "devolucao" | "venda" | "perda";
interface DadosAcerto {
  ambiente: AmbienteNfe;
  destinatario: DestinatarioNfe & { party_id: string };
  pendencias: string[];
  remessa: { ref: string; chave: string; numero: string | null; data: string; texto: string | null };
  operacoes: Record<OperacaoAcerto, { itens: (ItemBanco & { numero_item_origem: number })[]; nota_viva: { ref: string; status: string; numero: string | null } | null }>;
  sem_nota: { codigo: string; quantidade: number }[];
}
export interface Resultado { ref: string; status: string; mensagem: string | null; erros?: { codigo?: string; campo?: string; mensagem?: string }[] | null }

const prefixo = (amb: AmbienteNfe) => (amb === "producao" ? "lardan-mal" : "lardan-hom-mal");

/** Envia, grava o retorno e, se autorizada em produção, manda a cópia ao escritório. */
async function enviar(amb: AmbienteNfe, ref: string, nfe: Record<string, unknown>): Promise<Resultado> {
  const { emitirNfe, ErroFocus } = await import("./api.server");
  try {
    const r = await emitirNfe(amb, ref, nfe);
    const salvo = await rpcServidor<{ status: string }>("fiscal_focus_retorno", { _ref: ref, _fonte: "envio", _resposta: r.dados ?? {} });
    if (salvo.status === "autorizado" && amb === "producao") await enviarCopias(5).catch(() => undefined);
    return { ref, status: salvo.status, mensagem: r.dados?.mensagem_sefaz ?? r.dados?.mensagem ?? r.dados?.erros?.[0]?.mensagem ?? null, erros: r.dados?.erros ?? null };
  } catch (e) {
    const msg = e instanceof ErroFocus ? e.message : "Falha ao enviar à Focus.";
    await rpcServidor("fiscal_focus_retorno", { _ref: ref, _fonte: "envio", _resposta: { status: "erro_envio", mensagem: msg } });
    return { ref, status: "erro_envio", mensagem: msg };
  }
}

/** Remessa da maleta conferida. `rpcDados` = sessão do Master ou o servidor. */
export async function emitirRemessaCiclo(rpcDados: ChamarRpc, cycleId: string, ator: string | null) {
  const { montarNfe, novaReferencia } = await import("./nfe");
  const em = await emitenteFiscal(rpcDados);
  const dados = await rpcDados<DadosMaleta>("fiscal_focus_maleta_dados", { _cycle: cycleId });
  if (dados.nota_viva) throw new Error("Esta maleta já tem nota de remessa. Consulte a nota em vez de emitir outra.");
  if (dados.pendencias.length) throw new Error(`Cadastro incompleto: ${dados.pendencias.join("; ")}.`);
  const amb = dados.ambiente;
  const nfe = montarNfe({
    operacao: "remessa", ambiente: amb, cnpjEmitente: em.cnpj, ufEmitente: em.uf, destinatario: dados.destinatario,
    itens: dados.itens.map((i) => ({ codigo: i.codigo, descricao: i.descricao, ncm: i.ncm, quantidade: i.quantidade, preco_varejo_cents: i.preco_varejo_cents })),
    remessa: { numero: dados.remessa.numero ?? "-", kit: dados.remessa.kit ?? 1 }, origem: null,
  });
  const ref = novaReferencia(prefixo(amb), "remessa");
  await rpcServidor("fiscal_focus_envio_maleta_registrar", {
    _ref: ref, _ambiente: amb, _cycle: cycleId, _party: dados.destinatario.party_id,
    _composicao_versao: dados.composicao_versao, _payload: nfe, _ator: ator, _variantes: dados.itens.map((i) => i.variant_id),
  });
  return { ambiente: amb, ...(await enviar(amb, ref, nfe)) };
}

/** Notas do acerto (devolução, venda, perda) da maleta encerrada. */
export async function emitirAcertoCiclo(rpcDados: ChamarRpc, cycleId: string, ator: string | null) {
  const { montarNfe, novaReferencia } = await import("./nfe");
  const em = await emitenteFiscal(rpcDados);
  const dados = await rpcDados<DadosAcerto>("fiscal_focus_acerto_dados", { _cycle: cycleId });
  if (dados.pendencias.length) throw new Error(`Cadastro incompleto: ${dados.pendencias.join("; ")}.`);
  const amb = dados.ambiente;
  const kit = /REMESSA:\s*([^\s]+)\s+KIT:\s*([^\s]+)/.exec(dados.remessa.texto ?? "");
  const origem = { chave: dados.remessa.chave, numero: dados.remessa.numero ?? "", data: dados.remessa.data };
  const resultados: (Resultado & { operacao: OperacaoAcerto })[] = [];
  for (const op of ["devolucao", "venda", "perda"] as const) {
    const o = dados.operacoes[op];
    if (o.nota_viva) { resultados.push({ operacao: op, ref: o.nota_viva.ref, status: o.nota_viva.status, mensagem: "já emitida" }); continue; }
    if (!o.itens.length) continue;
    const nfe = montarNfe({ operacao: op, ambiente: amb, cnpjEmitente: em.cnpj, ufEmitente: em.uf, destinatario: dados.destinatario,
      itens: o.itens, origem, remessa: kit ? { numero: kit[1]!, kit: kit[2]! } : null });
    const ref = novaReferencia(prefixo(amb), op);
    await rpcServidor("fiscal_focus_envio_acerto_registrar", {
      _ref: ref, _ambiente: amb, _cycle: cycleId, _operacao: op, _ref_origem: dados.remessa.ref,
      _party: dados.destinatario.party_id, _payload: nfe, _ator: ator,
    });
    resultados.push({ operacao: op, ...(await enviar(amb, ref, nfe)) });
  }
  if (!resultados.length) throw new Error("Nada a emitir: nenhuma peça voltou, foi vendida ou perdida nesta maleta.");
  return { ambiente: amb, resultados, semNota: dados.sem_nota };
}

/** Cópia do XML/DANFE ao escritório para as notas de produção autorizadas/canceladas que ainda não foram. */
export async function enviarCopias(limite = 20) {
  const { enviarEmailNfe } = await import("./api.server");
  const p = await rpcServidor<{ email: string | null; refs: { ref: string; ambiente: AmbienteNfe }[] }>("fiscal_focus_email_pendentes", { _limite: limite });
  if (!p.email) return { enviados: 0, falhas: 0 };
  let enviados = 0, falhas = 0;
  for (const n of p.refs) {
    try {
      await enviarEmailNfe(n.ambiente, n.ref, [p.email]);
      await rpcServidor("fiscal_focus_email_marcar", { _ref: n.ref, _ok: true, _email: p.email });
      enviados++;
    } catch {
      await rpcServidor("fiscal_focus_email_marcar", { _ref: n.ref, _ok: false, _email: p.email });
      falhas++;
    }
  }
  return { enviados, falhas };
}

/** Fila automática (a cada minuto): emite o que entrou na fila e manda as cópias pendentes. */
export async function processarFilaFiscal(limite = 5) {
  const itens = await rpcServidor<{ id: number; cycle_id: string; etapa: "remessa" | "acerto" }[]>("fiscal_fila_proximos", { _limite: limite });
  let feitos = 0, erros = 0;
  for (const it of itens) {
    try {
      if (it.etapa === "remessa") {
        const r = await emitirRemessaCiclo(rpcServidor, it.cycle_id, null);
        if (!["autorizado", "processando_autorizacao"].includes(r.status)) throw new Error(r.mensagem ?? r.status);
      } else {
        const r = await emitirAcertoCiclo(rpcServidor, it.cycle_id, null);
        const ruim = r.resultados.find((x) => !["autorizado", "processando_autorizacao"].includes(x.status));
        if (ruim) throw new Error(`${ruim.operacao}: ${ruim.mensagem ?? ruim.status}`);
      }
      await rpcServidor("fiscal_fila_resultado", { _id: it.id, _ok: true, _erro: null });
      feitos++;
    } catch (e) {
      const msg = (e as Error).message;
      // nota já existente não é erro: a fila só garante que ela exista
      const ok = /já tem nota/.test(msg);
      await rpcServidor("fiscal_fila_resultado", { _id: it.id, _ok: ok, _erro: ok ? null : msg });
      if (ok) feitos++; else erros++;
    }
  }
  const copias = await enviarCopias(20);
  return { processados: itens.length, feitos, erros, ...copias };
}
