/**
 * Documentos assinados no cadastro de quem assinou (0228). Somente servidor.
 * - importarDocumento: documento do painel da ZapSign → cadastro (CPF, telefone ou e-mail de quem assinou).
 * - guardarCopia: baixa o PDF assinado (o link da ZapSign expira em 60 min) e guarda no bucket privado "assinaturas".
 */
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

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
  const { detalharDocumento } = await import("./api.server");
  const d = await detalharDocumento(docToken);
  if (d.status !== "signed" || !d.signed_file) return null;
  const r = await fetch(d.signed_file);
  if (!r.ok) throw new Error(`Não foi possível baixar o PDF assinado (${r.status}).`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const { createHash } = await import("node:crypto");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const caminho = `${partyId}/${docToken}.pdf`;
  const sb = await admin();
  const up = await sb.storage.from("assinaturas").upload(caminho, bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(`Não foi possível guardar a cópia: ${up.error.message}`);
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
    if (d.status === "signed") await guardarCopia(docToken, conhecido.party_id).catch(() => null);
    return { resultado: "atualizado", titulo: d.name };
  }
  // do painel: o primeiro signatário que bater com um cadastro
  for (const s of d.signers ?? []) {
    const party = await rpc<string | null>("party_por_assinante", { _cpf: s.cpf ?? null, _fone: `${s.phone_country ?? ""}${s.phone_number ?? ""}`, _email: s.email ?? null });
    if (!party) continue;
    await rpc("assinatura_avulsa_registrar", { _d: {
      ambiente: configZapsign().ambiente, party_id: party, doc_token: d.token, signer_token: s.token, status: d.status,
      titulo: d.name, assinante: s.name, assinado_em: s.signed_at ?? "", criado_em: d.created_at ?? "",
    } });
    if (d.status === "signed") await guardarCopia(docToken, party).catch(() => null);
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
    await guardarCopia(f.doc_token, f.party_id).catch(() => null);
  }
  return r;
}
