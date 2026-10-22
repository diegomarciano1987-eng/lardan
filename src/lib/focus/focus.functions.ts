/**
 * Ações da Focus NFe chamadas pela tela (Integrações > Nota fiscal).
 * O usuário só pede; o servidor confere a permissão no banco, chama a Focus
 * e registra envio e retorno pelo executor interno (service_role).
 * Nesta versão: SÓ HOMOLOGAÇÃO (notas de teste, sem valor fiscal).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { OperacaoNfe } from "./nfe";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
type Ctx = { supabase: { rpc: Rpc }; userId: string };
const AMBIENTE = "homologacao" as const;

async function rpcUsuario<T>(c: Ctx, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await c.supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
async function rpcServidor<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin.rpc as unknown as Rpc)(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
async function exigir(c: Ctx, acao: "ver" | "emitir") {
  const ok = await rpcUsuario<boolean>(c, "fiscal_focus_pode", { _acao: acao });
  if (!ok) throw new Error(acao === "ver" ? "Sem permissão." : "Só o Master emite notas de teste.");
}

interface Emitente { cnpj: string; uf: string }
async function emitente(c: Ctx): Promise<Emitente> {
  const e = await rpcUsuario<{ cnpj?: string | null; uf?: string | null } | null>(c, "fiscal_focus_emitente");
  const cnpj = (e?.cnpj && e.cnpj.length === 14 ? e.cnpj : process.env["FOCUS_CNPJ_EMITENTE"] ?? "").replace(/\D/g, "");
  const uf = (e?.uf ?? process.env["FOCUS_UF_EMITENTE"] ?? "PR").toUpperCase();
  if (cnpj.length !== 14) throw new Error("Defina o emissor (Integrações > Nota fiscal) ou o segredo FOCUS_CNPJ_EMITENTE.");
  return { cnpj, uf };
}

interface DadosBanco {
  destinatario: import("./nfe").DestinatarioNfe & { party_id: string };
  itens: { variant_id: string; codigo: string; descricao: string; ncm: string; quantidade: number; preco_varejo_cents: number }[];
  pendencias: string[];
}
interface EnvioBanco {
  ref: string;
  operacao: OperacaoNfe;
  status: string;
  party_id: string | null;
  chave_nfe: string | null;
  numero: string | null;
  created_at: string;
  ambiente: "homologacao" | "producao";
  payload: { items?: { codigo_produto: string; descricao: string; codigo_ncm: string; quantidade_comercial: number; valor_unitario_comercial: number }[] };
  caminho_danfe: string | null;
  caminho_xml: string | null;
  caminho_xml_cancelamento: string | null;
}

/** Estado da integração para a tela (sem segredos). */
export const focusEstado = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = context as unknown as Ctx;
    await exigir(c, "ver");
    const { avaliarConfigFocus } = await import("./api.server");
    let emissor: Emitente | null = null;
    try {
      emissor = await emitente(c);
    } catch {
      emissor = null;
    }
    return {
      homologacao: avaliarConfigFocus("homologacao"),
      producaoConfigurada: avaliarConfigFocus("producao").pronto,
      emissor,
      podeEmitir: await rpcUsuario<boolean>(c, "fiscal_focus_pode", { _acao: "emitir" }),
    };
  });

/** Emite uma nota de TESTE em homologação. Remessa: consultora + peças. Demais: a partir da remessa autorizada. */
export const focusEmitirTeste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { operacao: OperacaoNfe; partyId?: string | null; itens?: { variantId: string; quantidade: number }[]; refOrigem?: string | null; quantidades?: Record<string, number> }) => {
    if (!["remessa", "devolucao", "venda", "perda"].includes(d?.operacao)) throw new Error("Operação inválida.");
    if (d.operacao === "remessa") {
      if (!d.partyId) throw new Error("Escolha a consultora.");
      if (!d.itens?.length) throw new Error("Escolha ao menos uma peça.");
    } else if (!d.refOrigem) {
      throw new Error("Escolha a remessa de origem.");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigir(c, "emitir");
    const { montarNfe, novaReferencia } = await import("./nfe");
    const { emitirNfe, ErroFocus } = await import("./api.server");
    const em = await emitente(c);

    let partyId: string;
    let itens: DadosBanco["itens"];
    let destinatario: DadosBanco["destinatario"];
    let origem: { chave: string; numero: string; data: string } | null = null;

    if (data.operacao === "remessa") {
      const dados = await rpcUsuario<DadosBanco>(c, "fiscal_focus_dados", {
        _party: data.partyId,
        _itens: (data.itens ?? []).map((i) => ({ variant_id: i.variantId, quantidade: Math.trunc(i.quantidade) })),
      });
      if (dados.pendencias.length) throw new Error(`Cadastro incompleto: ${dados.pendencias.join("; ")}.`);
      partyId = data.partyId!;
      itens = dados.itens;
      destinatario = dados.destinatario;
    } else {
      const rem = await rpcServidor<EnvioBanco | null>("fiscal_focus_envio", { _ref: data.refOrigem });
      if (!rem || rem.operacao !== "remessa" || rem.status !== "autorizado" || !rem.chave_nfe || !rem.party_id) {
        throw new Error("A nota de origem precisa ser uma remessa autorizada.");
      }
      const dados = await rpcUsuario<DadosBanco>(c, "fiscal_focus_dados", { _party: rem.party_id, _itens: [] });
      if (dados.pendencias.length) throw new Error(`Cadastro incompleto: ${dados.pendencias.join("; ")}.`);
      const q = data.quantidades ?? {};
      itens = (rem.payload.items ?? [])
        .map((i) => {
          const max = Number(i.quantidade_comercial);
          const pedida = q[i.codigo_produto] === undefined ? max : Math.trunc(Number(q[i.codigo_produto]));
          if (pedida > max) throw new Error(`Quantidade de ${i.codigo_produto} maior que a da remessa.`);
          return { variant_id: "", codigo: i.codigo_produto, descricao: i.descricao, ncm: i.codigo_ncm, quantidade: pedida,
                   preco_varejo_cents: Math.round(Number(i.valor_unitario_comercial) * 100) * 3 };
        })
        .filter((i) => i.quantidade > 0);
      if (!itens.length) throw new Error("Escolha ao menos uma peça.");
      partyId = rem.party_id;
      destinatario = dados.destinatario;
      origem = { chave: rem.chave_nfe, numero: rem.numero ?? "", data: rem.created_at.slice(0, 10) };
    }

    const nfe = montarNfe({
      operacao: data.operacao,
      ambiente: AMBIENTE,
      cnpjEmitente: em.cnpj,
      ufEmitente: em.uf,
      destinatario,
      itens: itens.map((i) => ({ codigo: i.codigo, descricao: i.descricao, ncm: i.ncm, quantidade: i.quantidade, preco_varejo_cents: i.preco_varejo_cents })),
      remessa: { numero: "TESTE", kit: 1 },
      origem,
    });
    const ref = novaReferencia("lardan-hom", data.operacao);
    await rpcServidor("fiscal_focus_envio_registrar", {
      _ref: ref, _ambiente: AMBIENTE, _operacao: data.operacao, _ref_origem: data.refOrigem ?? null,
      _party: partyId, _payload: nfe, _ator: c.userId,
    });
    try {
      const r = await emitirNfe(AMBIENTE, ref, nfe);
      const salvo = await rpcServidor<{ status: string }>("fiscal_focus_retorno", { _ref: ref, _fonte: "envio", _resposta: r.dados ?? {} });
      return { ref, status: salvo.status, mensagem: r.dados?.mensagem_sefaz ?? r.dados?.mensagem ?? null, erros: r.dados?.erros ?? null };
    } catch (e) {
      const msg = e instanceof ErroFocus ? e.message : "Falha ao enviar à Focus.";
      await rpcServidor("fiscal_focus_retorno", { _ref: ref, _fonte: "envio", _resposta: { status: "erro_envio", mensagem: msg } });
      throw new Error(msg);
    }
  });

/** Consulta a Focus e atualiza a nota. */
export const focusConsultar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ref: string }) => {
    if (!d?.ref || !/^[A-Za-z0-9_-]{6,60}$/.test(d.ref)) throw new Error("Referência inválida.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigir(c, "ver");
    const { consultarNfe } = await import("./api.server");
    const env = await rpcServidor<EnvioBanco | null>("fiscal_focus_envio", { _ref: data.ref });
    if (!env) throw new Error("Nota não encontrada.");
    const r = await consultarNfe(env.ambiente, data.ref);
    if (r.http === 404) return { ref: data.ref, status: env.status, mensagem: "A Focus ainda não tem esta referência." };
    const salvo = await rpcServidor<{ status: string }>("fiscal_focus_retorno", { _ref: data.ref, _fonte: "consulta", _resposta: r.dados ?? {} });
    return { ref: data.ref, status: salvo.status, mensagem: r.dados?.mensagem_sefaz ?? null };
  });

/** Links do DANFE e do XML (montados no servidor a partir do ambiente da nota). */
export const focusArquivos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ref: string }) => {
    if (!d?.ref || !/^[A-Za-z0-9_-]{6,60}$/.test(d.ref)) throw new Error("Referência inválida.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigir(c, "ver");
    const { urlArquivo } = await import("./api.server");
    const env = await rpcServidor<EnvioBanco | null>("fiscal_focus_envio", { _ref: data.ref });
    if (!env) throw new Error("Nota não encontrada.");
    return {
      danfe: urlArquivo(env.ambiente, env.caminho_danfe),
      xml: urlArquivo(env.ambiente, env.caminho_xml),
      xmlCancelamento: urlArquivo(env.ambiente, env.caminho_xml_cancelamento),
    };
  });

/** Cancela uma nota de teste autorizada (até 24 h depois da emissão). */
export const focusCancelar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ref: string; justificativa: string }) => {
    if (!d?.ref || !/^[A-Za-z0-9_-]{6,60}$/.test(d.ref)) throw new Error("Referência inválida.");
    const j = (d.justificativa ?? "").trim();
    if (j.length < 15 || j.length > 255) throw new Error("A justificativa precisa ter de 15 a 255 caracteres.");
    return { ref: d.ref, justificativa: j };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigir(c, "emitir");
    const { cancelarNfe } = await import("./api.server");
    const env = await rpcServidor<EnvioBanco | null>("fiscal_focus_envio", { _ref: data.ref });
    if (!env) throw new Error("Nota não encontrada.");
    if (env.status !== "autorizado") throw new Error("Só nota autorizada pode ser cancelada.");
    const r = await cancelarNfe(env.ambiente, data.ref, data.justificativa);
    const salvo = await rpcServidor<{ status: string }>("fiscal_focus_retorno", { _ref: data.ref, _fonte: "cancelamento", _resposta: r.dados ?? {} });
    return { ref: data.ref, status: salvo.status, mensagem: r.dados?.mensagem_sefaz ?? r.dados?.mensagem ?? null };
  });

/** Cadastra na Focus o aviso automático (webhook) de NF-e. */
export const focusRegistrarAviso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = context as unknown as Ctx;
    await exigir(c, "emitir");
    const { registrarAviso } = await import("./api.server");
    const em = await emitente(c);
    return registrarAviso(AMBIENTE, em.cnpj);
  });
