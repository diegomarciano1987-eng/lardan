/**
 * Assinatura digital (ZapSign) chamada pela tela: contrato da consultora e
 * promissória da maleta. O usuário só pede; o banco confere quem pode
 * (equipe ou o representante da consultora), o servidor monta o texto pelo
 * modelo, cria o documento na ZapSign (link enviado por WhatsApp à consultora)
 * e registra pelo executor interno.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
type Ctx = { supabase: { rpc: Rpc }; userId: string };
const UUID = /^[0-9a-f-]{36}$/i;

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

interface Dados {
  modelo: { titulo: string; texto: string; revisado: boolean };
  pendencias: string[];
  signer: { nome: string; cpf: string | null; whatsapp: string | null; email: string | null };
  campos: import("./modelo").CamposAssinatura;
}

export const zapsignEstado = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { configZapsign } = await import("./api.server");
    const c = configZapsign();
    return { pronto: c.pronto, ambiente: c.ambiente, avisoPronto: c.avisoPronto, faltando: c.faltando };
  });

/** Envia contrato (tipo "contrato") ou promissória da maleta (tipo "promissoria") para a consultora assinar. */
export const zapsignEnviar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { tipo: "contrato" | "promissoria"; partyId: string; cycleId?: string | null; rep?: string | null; reenviar?: boolean }) => {
    if (d?.tipo !== "contrato" && d?.tipo !== "promissoria") throw new Error("Tipo inválido.");
    if (!UUID.test(d.partyId ?? "")) throw new Error("Consultora inválida.");
    if (d.tipo === "promissoria" && !UUID.test(d.cycleId ?? "")) throw new Error("Escolha a maleta.");
    if (d.rep && !UUID.test(d.rep)) throw new Error("Representante inválido.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const dados = await rpcUsuario<Dados>(c, "assinatura_dados", { _tipo: data.tipo, _party: data.partyId, _cycle: data.cycleId ?? null, _rep: data.rep ?? null });
    const pendente = await rpcServidor<{ id: string; sign_url: string | null } | null>("assinatura_pendente",
      { _tipo: data.tipo, _party: data.partyId, _cycle: data.cycleId ?? null });
    if (pendente && !data.reenviar) {
      return { id: pendente.id, signUrl: pendente.sign_url, jaExistia: true, whatsapp: false };
    }
    if (dados.pendencias.length) throw new Error(`Complete o cadastro da consultora: ${dados.pendencias.join(", ")}.`);

    const { preencherModelo, valoresDosCampos, telefoneZapsign } = await import("./modelo");
    const { configZapsign, criarDocumento } = await import("./api.server");
    const { createHash } = await import("node:crypto");
    const cfg = configZapsign();
    const valores = valoresDosCampos(dados.campos);
    const titulo = preencherModelo(dados.modelo.titulo, valores).replace(/\\/g, "").slice(0, 250);
    const texto = preencherModelo(dados.modelo.texto, valores);
    const fone = telefoneZapsign(dados.signer.whatsapp);
    const externo = `lardan-${data.tipo}-${data.partyId.slice(0, 8)}-${Date.now().toString(36)}`;

    const doc = await criarDocumento({
      name: titulo, markdown_text: texto, external_id: externo, lang: "pt-br", brand_name: "LARDAN Semijoias",
      signers: [{
        name: dados.signer.nome, ...(fone ?? {}), ...(dados.signer.email ? { email: dados.signer.email } : {}),
        ...(dados.signer.cpf ? { cpf: dados.signer.cpf } : {}),
        auth_mode: "assinaturaTela", send_automatic_whatsapp: !!fone, send_automatic_email: !fone && !!dados.signer.email,
        lock_name: true, lock_phone: !!fone, external_id: data.partyId,
        custom_message: data.tipo === "contrato" ? "Olá! Segue o contrato de consignação da LARDAN para você assinar." : "Olá! Segue a nota promissória da sua maleta LARDAN para você assinar.",
      }],
    });
    const signer = doc.signers?.[0];
    const reg = await rpcServidor<{ id: string }>("assinatura_registrar", { _d: {
      ambiente: cfg.ambiente, tipo: data.tipo, party_id: data.partyId, cycle_id: data.cycleId ?? "", rep: data.rep ?? "",
      doc_token: doc.token, signer_token: signer?.token ?? null, sign_url: signer?.sign_url ?? null, status: "pendente",
      titulo, texto_hash: createHash("sha256").update(texto).digest("hex"), valor_cents: dados.campos.valor_cents ?? "",
      whatsapp: !!fone, ator: c.userId, substitui: pendente?.id ?? "",
    } });
    return { id: reg.id, signUrl: signer?.sign_url ?? null, jaExistia: false, whatsapp: !!fone };
  });

/** Link novo do PDF assinado (o da ZapSign expira em 60 minutos). */
export const zapsignArquivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; rep?: string | null }) => {
    if (!UUID.test(d?.id ?? "")) throw new Error("Documento inválido.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const x = await rpcServidor<{ party_id: string; doc_token: string | null; arquivo_path: string | null } | null>("assinatura_ler", { _id: data.id });
    if (!x?.doc_token) throw new Error("Documento não encontrado.");
    const pode = await rpcUsuario<boolean>(c, "assinatura_pode", { _party: x.party_id, _rep: data.rep ?? null });
    if (!pode) throw new Error("Sem permissão.");
    if (x.arquivo_path) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const s = await supabaseAdmin.storage.from("assinaturas").createSignedUrl(x.arquivo_path, 300);
      if (s.error) throw new Error("Arquivo indisponível.");
      return { url: s.data.signedUrl, status: "signed" };
    }
    const { importarDocumento } = await import("./documentos.server");
    await importarDocumento(x.doc_token).catch(() => null);
    const y = await rpcServidor<{ arquivo_path: string | null } | null>("assinatura_ler", { _id: data.id });
    if (y?.arquivo_path) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const s = await supabaseAdmin.storage.from("assinaturas").createSignedUrl(y.arquivo_path, 300);
      if (!s.error) return { url: s.data.signedUrl, status: "signed" };
    }
    const { detalharDocumento } = await import("./api.server");
    const d = await detalharDocumento(x.doc_token);
    return { url: d.signed_file ?? d.original_file ?? null, status: d.status };
  });

/** Modelos (Master edita). */
export const zapsignModeloSalvar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { tipo: "contrato" | "promissoria" | "confissao"; titulo: string; texto: string; revisado: boolean }) => d)
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await rpcUsuario(c, "assinatura_modelo_salvar", { _tipo: data.tipo, _titulo: data.titulo, _texto: data.texto, _revisado: data.revisado });
    return { tipo: data.tipo };
  });

/** Link (5 min) do documento assinado para a aba "Documentos assinados" do cadastro (0228). */
export const documentoAssinadoLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { fonte: "zapsign" | "clicksign"; id: string }) => {
    if ((d?.fonte !== "zapsign" && d?.fonte !== "clicksign") || !UUID.test(d.id ?? "")) throw new Error("Documento inválido.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.fonte === "clicksign") {
      const { data: r } = await supabaseAdmin.from("kit_signature_requests").select("consultora_party_id, signed_path").eq("id", data.id).maybeSingle();
      if (!r) throw new Error("Documento não encontrado.");
      if (!(await rpcUsuario<boolean>(c, "documentos_pode_ver", { _party: r.consultora_party_id }))) throw new Error("Sem permissão.");
      const caminho = r.signed_path;
      if (!caminho) throw new Error("Arquivo indisponível.");
      const s = await supabaseAdmin.storage.from("termos-maleta").createSignedUrl(caminho, 300);
      if (s.error) throw new Error("Arquivo indisponível.");
      return { url: s.data.signedUrl };
    }
    const x = await rpcServidor<{ party_id: string; doc_token: string | null; arquivo_path: string | null } | null>("assinatura_ler", { _id: data.id });
    if (!x) throw new Error("Documento não encontrado.");
    if (!(await rpcUsuario<boolean>(c, "documentos_pode_ver", { _party: x.party_id }))) throw new Error("Sem permissão.");
    let caminho = x.arquivo_path;
    if (!caminho && x.doc_token) {
      const { guardarCopia } = await import("./documentos.server");
      caminho = await guardarCopia(x.doc_token, x.party_id).catch(() => null);
    }
    if (caminho) {
      const s = await supabaseAdmin.storage.from("assinaturas").createSignedUrl(caminho, 300);
      if (!s.error) return { url: s.data.signedUrl };
    }
    if (!x.doc_token) throw new Error("Arquivo indisponível.");
    const { detalharDocumento } = await import("./api.server");
    const d = await detalharDocumento(x.doc_token);
    return { url: d.signed_file ?? null };
  });

/** Master: importa para os cadastros tudo que já existe na conta da ZapSign (inclusive o criado no painel). */
export const zapsignSincronizar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { pagina: number }) => {
    if (!Number.isInteger(d?.pagina) || d.pagina < 1) throw new Error("Página inválida.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const master = await rpcUsuario<boolean>(c, "fiscal_focus_pode", { _acao: "emitir" });
    if (!master) throw new Error("Só o Master importa os documentos da ZapSign.");
    const { sincronizarPagina } = await import("./documentos.server");
    return sincronizarPagina(data.pagina);
  });

interface DadosConfissao extends Dados { party_id: string; pendente: { id: string; sign_url: string | null } | null }

/** Termo de confissão de dívida de um acordo: token por WhatsApp (ou e-mail) + selfie + foto do documento. */
export const zapsignConfissao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { simulacaoId: string; reenviar?: boolean }) => {
    if (!UUID.test(d?.simulacaoId ?? "")) throw new Error("Acordo inválido.");
    return { simulacaoId: d.simulacaoId, reenviar: !!d.reenviar };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const dados = await rpcUsuario<DadosConfissao>(c, "cob_confissao_dados", { _simulacao: data.simulacaoId });
    if (dados.pendente && !data.reenviar) return { id: dados.pendente.id, signUrl: dados.pendente.sign_url, jaExistia: true, whatsapp: false };
    if (dados.pendencias.length) throw new Error(`Complete o cadastro antes do termo: ${dados.pendencias.join(", ")}.`);
    const { preencherModelo, valoresDosCampos, telefoneZapsign } = await import("./modelo");
    const { configZapsign, criarDocumento } = await import("./api.server");
    const { createHash } = await import("node:crypto");
    const cfg = configZapsign();
    if (!cfg.pronto) throw new Error("Assinatura digital não configurada.");
    const campos = dados.campos as unknown as Record<string, unknown>;
    const valores = { ...valoresDosCampos(dados.campos), plano: String(campos.plano ?? ""), dividas: String(campos.dividas ?? "") };
    const titulo = preencherModelo(dados.modelo.titulo, valores).replace(/\\/g, "").slice(0, 250);
    const texto = dados.modelo.texto.replace(/\{\{\s*(plano|dividas)\s*\}\}/g, (_m, k: string) => valores[k as "plano"] || "________________");
    const final = preencherModelo(texto, valores);
    const fone = telefoneZapsign(dados.signer.whatsapp);
    const doc = await criarDocumento({
      name: titulo, markdown_text: final, external_id: `lardan-confissao-${data.simulacaoId.slice(0, 8)}-${Date.now().toString(36)}`, lang: "pt-br", brand_name: "LARDAN Semijoias",
      signers: [{
        name: dados.signer.nome, ...(fone ?? {}), ...(dados.signer.email ? { email: dados.signer.email } : {}),
        ...(dados.signer.cpf ? { cpf: dados.signer.cpf } : {}),
        auth_mode: fone ? "assinaturaTela-tokenWhatsapp" : "assinaturaTela-tokenEmail",
        require_selfie_photo: true, require_document_photo: true,
        send_automatic_whatsapp: !!fone, send_automatic_email: !fone && !!dados.signer.email,
        lock_name: true, lock_phone: !!fone, lock_email: !!dados.signer.email, external_id: dados.party_id,
        custom_message: "Olá! Segue o termo do seu acordo com a LARDAN para você assinar. Tenha seu documento em mãos: vamos pedir um código, uma selfie e a foto do documento.",
      }],
    });
    const signer = doc.signers?.[0];
    const reg = await rpcServidor<{ id: string }>("assinatura_registrar", { _d: {
      ambiente: cfg.ambiente, tipo: "confissao", party_id: dados.party_id, cycle_id: "", rep: "", simulacao_id: data.simulacaoId,
      doc_token: doc.token, signer_token: signer?.token ?? null, sign_url: signer?.sign_url ?? null, status: "pendente",
      titulo, texto_hash: createHash("sha256").update(final).digest("hex"), valor_cents: dados.campos.valor_cents ?? "",
      whatsapp: !!fone, ator: c.userId, substitui: dados.pendente?.id ?? "",
    } });
    return { id: reg.id, signUrl: signer?.sign_url ?? null, jaExistia: false, whatsapp: !!fone };
  });
