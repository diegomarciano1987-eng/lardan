/**
 * Somente servidor. Envio de contrato/promissória (mesma regra do botão "Enviar para assinar")
 * e recusa na ZapSign das promissórias substituídas quando a maleta é transferida (0279).
 */
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export type CtxAssinatura = { supabase: { rpc: Rpc }; userId: string };

async function rpcUsuario<T>(c: CtxAssinatura, fn: string, args: Record<string, unknown> = {}): Promise<T> {
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

export interface PedidoAssinatura { tipo: "contrato" | "promissoria"; partyId: string; cycleId?: string | null; rep?: string | null; reenviar?: boolean }

/** O banco confere quem pode (assinatura_dados); o texto sai do modelo; o link vai por WhatsApp. */
export async function enviarAssinatura(c: CtxAssinatura, data: PedidoAssinatura) {
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
}

/**
 * Recusa na ZapSign a promissória substituída: o link antigo deixa de aceitar assinatura.
 * Já assinada/recusada/inexistente na ZapSign = estado final, marca como feita. Falha de rede
 * fica na fila (a rotina de 10 minutos tenta de novo).
 */
export async function recusarNaZapsign(tokens: string[], motivo = "Maleta transferida para outra consultora.") {
  const { recusarDocumento, ErroZapsign } = await import("./api.server");
  const r = { recusados: 0, finais: 0, falhas: 0 };
  for (const t of tokens) {
    try {
      await recusarDocumento(t, motivo.slice(0, 250));
      await rpcServidor("assinatura_zapsign_cancelada", { _doc_token: t, _resultado: "recusado" });
      r.recusados++;
    } catch (e) {
      const http = e instanceof ErroZapsign ? e.http : null;
      if (http === 403 || http === 404) {
        await rpcServidor("assinatura_zapsign_cancelada", { _doc_token: t, _resultado: `final_${http}` }).catch(() => null);
        r.finais++;
      } else {
        r.falhas++;
      }
    }
  }
  return r;
}

/** Rotina: tenta de novo as recusas que não confirmaram. */
export async function recusarFilaZapsign(limite = 10) {
  const lista = await rpcServidor<{ doc_token: string; motivo: string | null }[]>("assinaturas_zapsign_cancelar_fila", { _limite: limite });
  if (!lista.length) return { recusados: 0, finais: 0, falhas: 0 };
  const { configZapsign } = await import("./api.server");
  if (!configZapsign().pronto) return { recusados: 0, finais: 0, falhas: lista.length };
  return recusarNaZapsign(lista.map((x) => x.doc_token));
}
