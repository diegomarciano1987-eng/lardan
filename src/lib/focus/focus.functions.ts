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
/** NF-e da maleta (remessa/acerto): Master ou equipe de montagem (kit.manage). */
async function exigirMaleta(c: Ctx) {
  const ok = await rpcUsuario<boolean>(c, "fiscal_focus_pode_maleta");
  if (!ok) throw new Error("Sem permissão para emitir a nota da maleta.");
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
  itens: { variant_id: string; codigo: string; descricao: string; ncm: string; quantidade: number; preco_varejo_cents: number; numero_item_origem?: number | null }[];
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
  payload: { items?: { numero_item?: number; codigo_produto: string; descricao: string; codigo_ncm: string; quantidade_comercial: number; valor_unitario_comercial: number }[] };
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
        .map((i, n) => {
          const max = Number(i.quantidade_comercial);
          const pedida = q[i.codigo_produto] === undefined ? max : Math.trunc(Number(q[i.codigo_produto]));
          if (pedida > max) throw new Error(`Quantidade de ${i.codigo_produto} maior que a da remessa.`);
          return { variant_id: "", codigo: i.codigo_produto, descricao: i.descricao, ncm: i.codigo_ncm, quantidade: pedida,
                   preco_varejo_cents: Math.round(Number(i.valor_unitario_comercial) * 100) * 3,
                   numero_item_origem: Number(i.numero_item) || n + 1 };
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
      itens: itens.map((i) => ({ codigo: i.codigo, descricao: i.descricao, ncm: i.ncm, quantidade: i.quantidade, preco_varejo_cents: i.preco_varejo_cents,
        numero_item_origem: i.numero_item_origem ?? null })),
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

/**
 * NF-e de remessa da MALETA conferida. Ambiente pelo banco: homologação até o
 * Master ligar a produção; depois produção (maleta piloto ou todas).
 */
export const focusEmitirRemessaMaleta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cycleId: string }) => {
    if (!d?.cycleId || !/^[0-9a-f-]{36}$/i.test(d.cycleId)) throw new Error("Maleta inválida.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirMaleta(c);
    // Permissão conferida com a sessão do usuário; dados e registro pelo executor interno, com o usuário como autor.
    const { emitirRemessaCiclo, rpcServidor: rpcSrv } = await import("./emissao.server");
    return emitirRemessaCiclo(rpcSrv, data.cycleId, c.userId);
  });

/** Notas do ACERTO da maleta encerrada: devolução, venda e perda ligadas à remessa autorizada. */
export const focusEmitirAcertoMaleta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cycleId: string }) => {
    if (!d?.cycleId || !/^[0-9a-f-]{36}$/i.test(d.cycleId)) throw new Error("Maleta inválida.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirMaleta(c);
    const { emitirAcertoCiclo, rpcServidor: rpcSrv } = await import("./emissao.server");
    return emitirAcertoCiclo(rpcSrv, data.cycleId, c.userId);
  });

/** Painel da emissão real (sem segredos): estado no banco + se o token de produção está no Lovable. */
export const focusProducaoEstado = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = context as unknown as Ctx;
    await exigir(c, "ver");
    const { avaliarConfigFocus } = await import("./api.server");
    const estado = await rpcUsuario<Record<string, any>>(c, "fiscal_producao_estado");
    const cfg = avaliarConfigFocus("producao");
    return { ...estado, tokenProducao: cfg.pronto, faltando: cfg.faltando, podeEmitir: await rpcUsuario<boolean>(c, "fiscal_focus_pode", { _acao: "emitir" }) };
  });

/** Master liga/desliga a produção e define piloto, liberação geral, automático e e-mail de cópia. */
export const focusProducaoDefinir = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ligar: boolean; pilotoKit: string | null; todas: boolean; automatico: boolean; email: string | null; confirmacao?: string | null }) => {
    if (typeof d?.ligar !== "boolean") throw new Error("Pedido inválido.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigir(c, "emitir");
    if (data.ligar) {
      const { avaliarConfigFocus } = await import("./api.server");
      const cfg = avaliarConfigFocus("producao");
      if (!cfg.pronto) throw new Error(`Produção da Focus não configurada no Lovable: falta ${cfg.faltando.join(", ")}.`);
    }
    return rpcUsuario<Record<string, any>>(c, "fiscal_producao_definir", {
      _ligar: data.ligar, _piloto_kit: data.pilotoKit, _todas: data.todas, _automatico: data.automatico,
      _email: data.email, _confirmacao: data.confirmacao ?? null,
    });
  });

/** Manda o XML e o DANFE de uma nota (teste ou real) para o e-mail do escritório. Só Master. */
export const focusEnviarEscritorio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ref: string; email?: string | null }) => {
    if (!d?.ref || !/^[A-Za-z0-9_-]{6,60}$/.test(d.ref)) throw new Error("Referência inválida.");
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) throw new Error("E-mail inválido.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigir(c, "emitir");
    const { enviarEmailNfe } = await import("./api.server");
    const env = await rpcServidor<EnvioBanco | null>("fiscal_focus_envio", { _ref: data.ref });
    if (!env) throw new Error("Nota não encontrada.");
    if (!["autorizado", "cancelado"].includes(env.status)) throw new Error("Só nota autorizada ou cancelada pode ser enviada.");
    const estado = await rpcUsuario<{ email_copia?: string | null }>(c, "fiscal_producao_estado");
    const email = data.email || estado.email_copia;
    if (!email) throw new Error("Defina o e-mail do escritório no painel da emissão real.");
    await enviarEmailNfe(env.ambiente, data.ref, [email]);
    if (env.ambiente === "producao") await rpcServidor("fiscal_focus_email_marcar", { _ref: data.ref, _ok: true, _email: email });
    return { email };
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
    if (!(await rpcUsuario<boolean>(c, "fiscal_focus_pode_danfe", { _ref: data.ref }))) await exigir(c, "ver");
    const { consultarNfe } = await import("./api.server");
    const env = await rpcServidor<EnvioBanco | null>("fiscal_focus_envio", { _ref: data.ref });
    if (!env) throw new Error("Nota não encontrada.");
    const r = await consultarNfe(env.ambiente, data.ref);
    if (r.http === 404) {
      // registrada aqui mas nunca chegou à Focus (queda no meio do envio): depois de 15 min libera nova emissão
      if (env.status === "pendente" && Date.now() - new Date(env.created_at).getTime() > 15 * 60_000) {
        const salvo = await rpcServidor<{ status: string }>("fiscal_focus_retorno", { _ref: data.ref, _fonte: "consulta",
          _resposta: { status: "erro_envio", mensagem: "A nota não chegou à Focus; pode emitir de novo." } });
        return { ref: data.ref, status: salvo.status, mensagem: "A nota não chegou à Focus; pode emitir de novo." };
      }
      return { ref: data.ref, status: env.status, mensagem: "A Focus ainda não tem esta referência." };
    }
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

/**
 * 0318: inutiliza números de NF-e de PRODUÇÃO que ficaram para trás na série (ex.: recusa 635 que nunca virou nota).
 * Só quem emite (Master). O banco confere a faixa antes (passada, sem nota registrada, ≤ 20 números, não inutilizada)
 * e guarda a resposta; se a SEFAZ confirmou, as recusas incertas indicadas ganham a conferência "não foi autorizada".
 */
export const focusInutilizar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { serie: string; numeroInicial: number; numeroFinal: number; justificativa: string; refs?: string[] }) => {
    const serie = String(d?.serie ?? "").trim();
    if (!/^[0-9]{1,3}$/.test(serie)) throw new Error("Série inválida.");
    const ini = Number(d?.numeroInicial);
    const fim = Number(d?.numeroFinal);
    if (!Number.isInteger(ini) || !Number.isInteger(fim) || ini < 1 || fim < ini) throw new Error("Faixa inválida.");
    if (fim - ini >= 20) throw new Error("No máximo 20 números por pedido.");
    const j = (d?.justificativa ?? "").trim();
    if (j.length < 15 || j.length > 255) throw new Error("A justificativa precisa ter de 15 a 255 caracteres.");
    const refs = (d?.refs ?? []).filter((r) => /^[A-Za-z0-9_-]{6,60}$/.test(r)).slice(0, 20);
    return { serie, numeroInicial: ini, numeroFinal: fim, justificativa: j, refs };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigir(c, "emitir");
    const ambiente = "producao" as const;
    const motivo = await rpcServidor<string | null>("fiscal_inutilizacao_faixa_motivo", {
      _ambiente: ambiente, _serie: data.serie, _ini: data.numeroInicial, _fim: data.numeroFinal,
    });
    if (motivo) throw new Error(motivo);
    const em = await emitente(c);
    const { inutilizarNfe } = await import("./api.server");
    const r = await inutilizarNfe(ambiente, {
      cnpj: em.cnpj, serie: data.serie, numero_inicial: data.numeroInicial, numero_final: data.numeroFinal, justificativa: data.justificativa,
    });
    return rpcServidor<{ ok: boolean; resultado: string; status_sefaz: string | null; mensagem: string | null; protocolo: string | null; recusas_baixadas: number }>(
      "fiscal_inutilizacao_registrar",
      {
        _ambiente: ambiente, _serie: data.serie, _ini: data.numeroInicial, _fim: data.numeroFinal, _justificativa: data.justificativa,
        _resposta: r.dados ?? {}, _refs: data.refs, _usuario: c.userId,
      },
    );
  });

/** Cadastra na Focus o aviso automático (webhook) de NF-e. */
export const focusRegistrarAviso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = context as unknown as Ctx;
    await exigir(c, "emitir");
    const { registrarAviso } = await import("./api.server");
    const em = await emitente(c);
    const { avaliarConfigFocus } = await import("./api.server");
    const hom = await registrarAviso(AMBIENTE, em.cnpj);
    // produção (0216): o aviso também precisa existir no ambiente real
    const prod = avaliarConfigFocus("producao").pronto ? await registrarAviso("producao", em.cnpj) : null;
    return { ...hom, producao: prod };
  });

/**
 * XML autorizado da nota para o DANFE enxuto (0224): uma linha por peça.
 * Pode: quem vê o fiscal ou quem gerencia maletas (nota ligada a uma maleta).
 */
export const focusDanfeXml = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ref: string }) => {
    if (!d?.ref || !/^[A-Za-z0-9_-]{6,60}$/.test(d.ref)) throw new Error("Referência inválida.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    if (!(await rpcUsuario<boolean>(c, "fiscal_focus_pode_danfe", { _ref: data.ref }))) throw new Error("Sem permissão para esta nota.");
    const { urlArquivo } = await import("./api.server");
    const env = await rpcServidor<EnvioBanco | null>("fiscal_focus_envio", { _ref: data.ref });
    if (!env) throw new Error("Nota não encontrada.");
    const url = urlArquivo(env.ambiente, env.caminho_xml);
    if (!url) throw new Error("O XML desta nota ainda não está disponível. Consulte a nota.");
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Não foi possível baixar o XML (${r.status}).`);
    const xml = await r.text();
    if (!/<infNFe/.test(xml)) throw new Error("O arquivo baixado não é uma NF-e.");
    return { xml, cancelada: env.status === "cancelado" };
  });
