/**
 * Documentos assinados no cadastro de quem assinou (0228). Somente servidor.
 * - importarDocumento: documento do painel da ZapSign → cadastro (CPF, telefone ou e-mail de quem assinou).
 * - guardarCopia: baixa o PDF assinado (o link da ZapSign expira em 60 min) e guarda no bucket privado "assinaturas".
 */
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

const MAX_PDF = 20 * 1024 * 1024;
/** Only provider document storage; never arbitrary URLs or redirects. */
export async function baixarPdfAssinado(endereco: string): Promise<Uint8Array> {
  const u = new URL(endereco);
  const permitido = u.hostname === "storage.googleapis.com" || u.hostname === "zapsign.com.br" ||
    u.hostname.endsWith(".zapsign.com.br") || /^(?:[a-z0-9.-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(u.hostname);
  if (u.protocol !== "https:" || u.username || u.password || u.port || !permitido) throw new Error("Endereço do PDF não autorizado.");
  const r = await fetch(u.href, { redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!r.ok || !r.body) throw new Error(`Não foi possível baixar o PDF assinado (${r.status}).`);
  if (Number(r.headers.get("content-length")) > MAX_PDF) throw new Error("PDF excede 20 MB.");
  const reader = r.body.getReader();
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > MAX_PDF) { await reader.cancel(); throw new Error("PDF excede 20 MB."); }
      partes.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(tamanho);
  let offset = 0;
  for (const parte of partes) { bytes.set(parte, offset); offset += parte.byteLength; }
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Arquivo recebido não é PDF.");
  return bytes;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = await admin();
  const { data, error } = await (sb.rpc as unknown as Rpc)(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Guarda a cópia do PDF assinado, uma vez. Devolve o caminho no bucket ou null se ainda não assinado. */
export async function guardarCopia(docToken: string, partyId: string): Promise<string | null> {
  const existente = await rpc<{ party_id: string; arquivo_path: string | null } | null>("assinatura_ler_por_token", { _doc_token: docToken });
  if (!existente || existente.party_id !== partyId) throw new Error("Documento não encontrado.");
  if (existente.arquivo_path) return existente.arquivo_path;
  const { detalharDocumento } = await import("./api.server");
  const d = await detalharDocumento(docToken);
  if (d.status !== "signed" || !d.signed_file) return null;
  const bytes = await baixarPdfAssinado(d.signed_file);
  const { createHash } = await import("node:crypto");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const caminho = `${partyId}/${docToken}.pdf`;
  const sb = await admin();
  const up = await sb.storage.from("assinaturas").upload(caminho, bytes, { contentType: "application/pdf", upsert: false });
  if (up.error) {
    // A simultaneous webhook may have already stored it; never overwrite the evidence.
    const salvo = await sb.storage.from("assinaturas").download(caminho);
    if (salvo.error || !salvo.data) throw new Error("Não foi possível guardar a cópia.");
    const hashSalvo = createHash("sha256").update(new Uint8Array(await salvo.data.arrayBuffer())).digest("hex");
    await rpc("assinatura_arquivo_salvar", { _doc_token: docToken, _path: caminho, _sha: hashSalvo });
    return caminho;
  }
  await rpc("assinatura_arquivo_salvar", { _doc_token: docToken, _path: caminho, _sha: sha });
  return caminho;
}

/**
 * Documento que chegou pelo aviso ou pela importação. Conhecido → atualiza a situação;
 * do painel → liga a quem assinou. Sempre guarda a cópia quando assinado.
 */
export async function importarDocumento(docToken: string): Promise<{ resultado: "atualizado" | "importado" | "sem_cadastro"; titulo: string; assinante?: string }> {
  const { detalharDocumento, configZapsign } = await import("./api.server");
  const d = await detalharDocumento(docToken);
  const conhecido = await rpc<{ party_id: string } | null>("assinatura_ler_por_token", { _doc_token: docToken });
  if (conhecido) {
    await rpc("assinatura_retorno", { _doc_token: docToken, _status: d.status, _assinado_em: d.signers?.[0]?.signed_at ?? null });
    if (d.status === "signed") await guardarCopia(docToken, conhecido.party_id);
    return { resultado: "atualizado", titulo: d.name };
  }
  // Multi-signer documents require review: do not choose the first matching person.
  if (d.signers?.length !== 1) return { resultado: "sem_cadastro", titulo: d.name, assinante: d.signers?.map((s) => s.name).join(", ") };
  for (const s of d.signers ?? []) {
    const party = await rpc<string | null>("party_por_assinante", { _cpf: s.cpf ?? null, _fone: `${s.phone_country ?? ""}${s.phone_number ?? ""}`, _email: s.email ?? null });
    if (!party) continue;
    await rpc("assinatura_avulsa_registrar", { _d: {
      ambiente: configZapsign().ambiente, party_id: party, doc_token: d.token, signer_token: s.token, status: d.status,
      titulo: d.name, assinante: s.name, assinado_em: s.signed_at ?? "", criado_em: d.created_at ?? "",
    } });
    if (d.status === "signed") await guardarCopia(docToken, party);
    return { resultado: "importado", titulo: d.name, assinante: s.name };
  }
  return { resultado: "sem_cadastro", titulo: d.name, assinante: d.signers?.map((s) => s.name).join(", ") };
}

/** Importa UMA página da conta da ZapSign (painel incluído) e completa até 10 cópias que faltam. A tela chama página a página. */
export async function sincronizarPagina(pagina: number) {
  const { listarDocumentos } = await import("./api.server");
  const r = { pagina, lidos: 0, importados: 0, atualizados: 0, sem_cadastro: [] as { titulo: string; assinante?: string }[], erros: 0, proxima: null as number | null, total: 0 };
  const pag = await listarDocumentos(pagina);
  r.total = pag.count ?? 0;
  for (const doc of pag.results ?? []) {
    r.lidos++;
    try {
      const x = await importarDocumento(doc.token);
      if (x.resultado === "importado") r.importados++;
      else if (x.resultado === "atualizado") r.atualizados++;
      else r.sem_cadastro.push({ titulo: x.titulo, ...(x.assinante ? { assinante: x.assinante } : {}) });
    } catch { r.erros++; }
  }
  r.proxima = pag.next ? pagina + 1 : null;
  for (const f of await rpc<{ doc_token: string; party_id: string }[]>("assinaturas_sem_copia", { _limite: 10 })) {
    await guardarCopia(f.doc_token, f.party_id).catch(() => { r.erros++; });
  }
  return r;
}
