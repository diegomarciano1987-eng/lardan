/**
 * PDV Loja — chamadas do terminal. A loja entra com número + senha; o servidor
 * guarda só o hash do token (cookie httpOnly). Toda regra (preço, desconto,
 * estoque, comissão, caixa) é revalidada no banco por rotinas exclusivas do servidor.
 */
import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie, deleteCookie, getRequestHeader } from "@tanstack/react-start/server";

const COOKIE = "lardan_pdv";

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as { rpc: (f: string, a: object) => PromiseLike<{ data: any; error: { message: string } | null }> };
}
async function rpc<T = any>(f: string, a: object): Promise<T> {
  const { data, error } = await (await admin()).rpc(f, a);
  if (error) throw new Error(error.message.includes("PDV_SESSAO_INVALIDA") ? "PDV_SESSAO_INVALIDA" : error.message);
  return data as T;
}
async function token() {
  const t = getCookie(COOKIE);
  if (!t) throw new Error("PDV_SESSAO_INVALIDA");
  return sha256(t);
}
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => { const n = Math.round(Number(v)); if (!Number.isFinite(n)) throw new Error("Valor inválido."); return n; };

const mascarar = (e: string) => { const [u, d] = e.split("@"); return `${(u ?? "").slice(0, 1)}***@${d ?? ""}`; };

/** Passo 1: número + senha + e-mail da pessoa. O código vai só por e-mail; nunca volta ao navegador. */
export const pdvEntrarIniciar = createServerFn({ method: "POST" })
  .inputValidator((d: { numero: string; senha: string; email: string }) => ({ numero: str(d?.numero, 10).replace(/\D/g, ""), senha: str(d?.senha, 100), email: str(d?.email, 255).trim().toLowerCase() }))
  .handler(async ({ data }) => {
    const r = await rpc<{ desafio: string; codigo: string; email: string; nome: string | null; unidade: string; numero: string }>("pdv_entrar_iniciar", { _numero: data.numero, _senha: data.senha, _email: data.email });
    const { sendTemplateEmail } = await import("./email-templates/send-email");
    const env = await sendTemplateEmail("codigo-pdv", r.email, {
      templateData: { nome: r.nome?.split(" ")[0], codigo: r.codigo, loja: `${r.unidade} nº ${r.numero}` },
      idempotencyKey: `pdv-codigo-${r.desafio}`,
    });
    if (!env.sent) throw new Error("Este e-mail está bloqueado para recebimento. Fale com a gestão.");
    return { desafio: r.desafio, email: mascarar(r.email) };
  });

/** Passo 2: código recebido por e-mail. Só aqui o aparelho ganha a sessão da loja. */
export const pdvEntrarConfirmar = createServerFn({ method: "POST" })
  .inputValidator((d: { desafio: string; codigo: string }) => ({ desafio: str(d?.desafio, 40), codigo: str(d?.codigo, 6).replace(/\D/g, "") }))
  .handler(async ({ data }) => {
    const bruto = crypto.randomUUID() + crypto.randomUUID();
    const r = await rpc<{ ok: boolean; erro?: string }>("pdv_entrar_confirmar", { _desafio: data.desafio, _codigo: data.codigo, _token_hash: await sha256(bruto), _ua: getRequestHeader("user-agent") ?? "" });
    if (!r.ok) throw new Error(r.erro || "Código incorreto.");
    setCookie(COOKIE, bruto, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 60 * 60 * 16 });
    return r;
  });

export const pdvSair = createServerFn({ method: "POST" }).handler(async () => {
  const t = getCookie(COOKIE);
  if (t) await rpc("pdv_sair", { _token_hash: await sha256(t) }).catch(() => undefined);
  deleteCookie(COOKIE, { path: "/" });
  return { ok: true };
});

export const pdvEstado = createServerFn({ method: "GET" }).handler(async () => {
  const t = getCookie(COOKIE);
  if (!t) return null;
  try { return await rpc("pdv_estado", { _token_hash: await sha256(t) }); }
  catch (e) { if ((e as Error).message === "PDV_SESSAO_INVALIDA") return null; throw e; }
});

export const pdvOperadora = createServerFn({ method: "POST" })
  .inputValidator((d: { membro: string; pin: string }) => ({ membro: str(d?.membro, 40), pin: str(d?.pin, 6) }))
  .handler(async ({ data }) => rpc("pdv_operadora", { _token_hash: await token(), _membro: data.membro, _pin: data.pin }));

export const pdvOperadoraSair = createServerFn({ method: "POST" }).handler(async () => rpc("pdv_operadora_sair", { _token_hash: await token() }));

export const pdvCaixaAbrir = createServerFn({ method: "POST" })
  .inputValidator((d: { fundo: number }) => ({ fundo: num(d?.fundo) }))
  .handler(async ({ data }) => rpc("pdv_caixa_abrir", { _token_hash: await token(), _fundo: data.fundo }));

export const pdvCaixaMov = createServerFn({ method: "POST" })
  .inputValidator((d: { tipo: "sangria" | "suprimento"; valor: number; motivo: string }) => {
    if (!["sangria", "suprimento"].includes(d?.tipo)) throw new Error("Tipo inválido.");
    return { tipo: d.tipo, valor: num(d.valor), motivo: str(d.motivo) };
  })
  .handler(async ({ data }) => rpc("pdv_caixa_mov", { _token_hash: await token(), _tipo: data.tipo, _valor: data.valor, _motivo: data.motivo }));

export const pdvCaixaFechar = createServerFn({ method: "POST" })
  .inputValidator((d: { contado: number; obs: string }) => ({ contado: num(d?.contado), obs: str(d?.obs, 500) }))
  .handler(async ({ data }) => rpc("pdv_caixa_fechar", { _token_hash: await token(), _contado: data.contado, _obs: data.obs }));

export const pdvBuscar = createServerFn({ method: "GET" })
  .inputValidator((d: { q: string }) => ({ q: str(d?.q, 80) }))
  .handler(async ({ data }) => rpc<any[]>("pdv_produto_buscar", { _token_hash: await token(), _q: data.q }));

export type PagamentoPdv = { forma: "dinheiro" | "debito" | "credito" | "pix" | "link_cartao"; valor_cents: number; recebido_cents?: number; maquininha_id?: string; parcelas?: number; nsu?: string };
export const pdvConcluir = createServerFn({ method: "POST" })
  .inputValidator((d: { idem: string; itens: { variant_id: string; qtd: number }[]; desconto_cents: number; cliente: { nome?: string; doc?: string; telefone?: string }; pagamentos: PagamentoPdv[] }) => {
    if (!d?.idem || !Array.isArray(d.itens) || !Array.isArray(d.pagamentos)) throw new Error("Venda incompleta.");
    return d;
  })
  .handler(async ({ data }) => rpc("pdv_venda_concluir", { _token_hash: await token(), _p: data }));

/** Cobrança online real (Pix ou link de cartão de crédito): título a receber + cobrança no Asaas pelo motor oficial. Confirmação só pelo aviso do Asaas. */
export const pdvPixGerar = createServerFn({ method: "POST" })
  .inputValidator((d: { venda: string }) => ({ venda: str(d?.venda, 40) }))
  .handler(async ({ data }) => {
    const th = await token();
    const t = await rpc<{ installment_id: string; actor: string; forma?: string }>("pdv_pix_titulo", { _token_hash: th, _venda: data.venda }).catch((e: Error) => {
      if (/Sem permissão para este tipo de título/.test(e.message)) throw new Error("O responsável pelo Pix desta loja não tem permissão de contas a receber. A gestão precisa trocar em PDV Loja → Acesso por alguém do financeiro.");
      throw e;
    });
    const cartao = t.forma === "link_cartao";
    const { solicitarCobranca } = await import("./asaas/operacoes");
    const { bancoExecutor } = await import("./asaas/servidor.server");
    const { envDoServidor } = await import("./asaas/configuracao.server");
    const executor = await bancoExecutor();
    // A preparação roda em nome do responsável Pix definido pela gestão da loja.
    const usuario = { rpc: <T,>(_f: string, a: Record<string, unknown>) => rpc<T>("pdv_asaas_preparar", { _actor: t.actor, _payload: a["_payload"] }) };
    const r = await solicitarCobranca(usuario as never, executor, t.actor, { installmentId: t.installment_id, billingType: cartao ? "CREDIT_CARD" : "PIX" }, { env: envDoServidor() });
    if ((r as { state: string }).state === "indisponivel") throw new Error((r as { aviso?: string }).aviso || "Cobrança indisponível no momento.");
    const rr = r as { charge_id?: string | null; invoice_url?: string | null };
    await rpc("pdv_pix_registrar", { _token_hash: th, _venda: data.venda, _charge: rr.charge_id ?? null, _url: rr.invoice_url ?? null });
    // Copia-e-cola e QR oficiais do Asaas (só Pix); no cartão a tela usa o link da fatura.
    let copia: string | null = null; let qr: string | null = null;
    const ext = (r as { external_id?: string | null; simulado?: boolean }).external_id;
    if (!cartao && ext && !(r as { simulado?: boolean }).simulado) {
      try {
        const { resolverPorParcela } = await import("./asaas/servidor.server");
        const { transporteDaResolucao } = await import("./asaas/configuracao.server");
        const tr = (await transporteDaResolucao(await resolverPorParcela(t.installment_id, t.actor))) as unknown as { pixQrCode?: (id: string) => Promise<{ payload: string | null; encodedImage: string | null }> };
        const px = await tr.pixQrCode?.(ext);
        copia = px?.payload ?? null; qr = px?.encodedImage ? `data:image/png;base64,${px.encodedImage}` : null;
      } catch (e) { console.error("pix qrcode", (e as Error).message); }
    }
    return { url: rr.invoice_url ?? null, copia, qr, forma: cartao ? "link_cartao" : "pix" };
  });

export const pdvPixSituacao = createServerFn({ method: "GET" })
  .inputValidator((d: { venda: string }) => ({ venda: str(d?.venda, 40) }))
  .handler(async ({ data }) => rpc<{ status: string; pix_url: string | null }>("pdv_pix_situacao", { _token_hash: await token(), _venda: data.venda }));

export const pdvCancelar = createServerFn({ method: "POST" })
  .inputValidator((d: { venda: string; motivo: string }) => ({ venda: str(d?.venda, 40), motivo: str(d?.motivo, 300) }))
  .handler(async ({ data }) => rpc("pdv_venda_cancelar", { _token_hash: await token(), _venda: data.venda, _motivo: data.motivo }));

export const pdvComprovante = createServerFn({ method: "GET" })
  .inputValidator((d: { venda: string }) => ({ venda: str(d?.venda, 40) }))
  .handler(async ({ data }) => rpc("pdv_comprovante", { _token_hash: await token(), _venda: data.venda }));

export type ClientePdv = { party_id?: string; nome: string; doc?: string; telefone?: string; email?: string; instagram?: string; nascimento?: string; cep?: string; rua?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; uf?: string; observacoes?: string };
const CAMPOS_CLIENTE = ["party_id", "nome", "doc", "telefone", "email", "instagram", "nascimento", "cep", "rua", "numero", "complemento", "bairro", "cidade", "uf", "observacoes"] as const;

/** Grava (ou atualiza) a cliente no cadastro oficial e liga à loja. Não associa por nome: só CPF ou WhatsApp já da loja. */
export const pdvClienteSalvar = createServerFn({ method: "POST" })
  .inputValidator((d: ClientePdv) => {
    const o: Record<string, string> = {};
    for (const k of CAMPOS_CLIENTE) o[k] = str((d as Record<string, unknown>)?.[k], k === "observacoes" ? 500 : 160).trim();
    return o as unknown as ClientePdv;
  })
  .handler(async ({ data }) => rpc<{ party_id: string; nome: string }>("pdv_cliente_salvar", { _token_hash: await token(), _c: data }));

export const pdvVendaVincularCliente = createServerFn({ method: "POST" })
  .inputValidator((d: { venda: string; party: string }) => ({ venda: str(d?.venda, 40), party: str(d?.party, 40) }))
  .handler(async ({ data }) => rpc("pdv_venda_vincular_cliente", { _token_hash: await token(), _venda: data.venda, _party: data.party }));

export const pdvClientes = createServerFn({ method: "GET" })
  .inputValidator((d: { q: string }) => ({ q: str(d?.q, 80) }))
  .handler(async ({ data }) => rpc<any[]>("pdv_clientes_listar", { _token_hash: await token(), _q: data.q }));

export const pdvVendas = createServerFn({ method: "GET" })
  .inputValidator((d: { dias: number }) => ({ dias: Math.min(Math.max(Math.round(Number(d?.dias) || 1), 1), 365) }))
  .handler(async ({ data }) => rpc<any[]>("pdv_vendas_listar", { _token_hash: await token(), _dias: data.dias }));

/** Histórico de links de pagamento enviados (Pix e link de cartão Asaas) da unidade. */
export const pdvLinksEnviados = createServerFn({ method: "GET" })
  .inputValidator((d: { dias?: number }) => ({ dias: Math.min(Math.max(Math.round(Number(d?.dias) || 30), 1), 365) }))
  .handler(async ({ data }) => rpc<any[]>("pdv_links_listar", { _token_hash: await token(), _dias: data.dias }));
