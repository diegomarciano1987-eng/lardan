/**
 * Correios — etapa 1 (diagnóstico): confirma a conexão com o contrato e
 * descobre os códigos de serviço reais (PAC de contrato e PAC reverso), o
 * preço e o prazo da caixa padrão. Só Master. Nada é postado nem cobrado.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
type Ctx = { supabase: { rpc: Rpc }; userId: string };

async function exigirMaster(c: Ctx) {
  const { data, error } = await c.supabase.rpc("fiscal_focus_pode", { _acao: "emitir" });   // emitir = Master
  if (error || data !== true) throw new Error("Só o Master testa a conexão com os Correios.");
}

interface Servico { codigo: string; descricao: string }

export const correiosDiagnostico = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cepDestino: string; codigos?: string[] }) => {
    if (!/^\d{8}$/.test((d?.cepDestino ?? "").replace(/\D/g, ""))) throw new Error("Informe um CEP de destino com 8 dígitos.");
    return { cepDestino: d.cepDestino.replace(/\D/g, ""), codigos: (d.codigos ?? []).filter((x) => /^\d{5}$/.test(x)).slice(0, 6) };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirMaster(c);
    const api = await import("./api.server");
    const cfg = api.configCorreios();
    const r: Record<string, unknown> = { ambiente: cfg.ambiente, faltando: cfg.faltando, cepOrigem: cfg.cepOrigem, caixa: api.CAIXA_PADRAO };
    if (!cfg.pronto) return { ...r, ok: false, etapa: "configuração" };

    try {
      const t = await api.token();
      r["token"] = { ok: true, expiraEm: t.expiraEm, contrato: t.resposta };
    } catch (e) {
      return { ...r, ok: false, etapa: "token", erro: e instanceof api.ErroCorreios ? e.message : "Não foi possível autenticar nos Correios. Tente novamente.", detalhe: null };
    }

    try {
    const sv = await api.servicosDoContrato();
    const lista = ((sv.dados as { itens?: unknown[] } | unknown[] | null) && (Array.isArray(sv.dados) ? sv.dados : (sv.dados as { itens?: unknown[] }).itens)) ?? [];
    const servicos: Servico[] = (lista as Record<string, unknown>[]).map((s) => ({
      codigo: String(s["codigo"] ?? s["codigoServico"] ?? s["coServico"] ?? ""),
      descricao: String(s["descricao"] ?? s["descricaoServico"] ?? s["nome"] ?? ""),
    })).filter((s) => s.codigo);
    r["servicos"] = { http: sv.http, total: servicos.length, lista: servicos };

    // PAC: os do contrato com "PAC" no nome + os pedidos na tela (padrões conhecidos 03298 PAC contrato, 03301 PAC reverso)
    const pac = servicos.filter((s) => /PAC/i.test(s.descricao)).map((s) => s.codigo);
    const testar = [...new Set([...data.codigos, ...pac])].slice(0, 6);
    const precos: Record<string, unknown> = {};
    for (const cod of testar) {
      const [p, z] = await Promise.all([api.preco(cod, data.cepDestino), api.prazo(cod, data.cepDestino)]);
      precos[cod] = { descricao: servicos.find((s) => s.codigo === cod)?.descricao ?? null, preco: p, prazo: z };
    }
    r["testes"] = precos;
    const ok = testar.length > 0 && sv.http >= 200 && sv.http < 300 && Object.values(precos).every((v) => {
      const t = v as { preco: { http: number }; prazo: { http: number } };
      return t.preco.http >= 200 && t.preco.http < 300 && t.prazo.http >= 200 && t.prazo.http < 300;
    });
    return { ...r, ok, etapa: ok ? "concluído" : "consultas", ...(!ok ? { erro: "Uma ou mais consultas foram recusadas pelos Correios." } : {}) };
    } catch (e) {
      return { ...r, ok: false, etapa: "consultas", erro: e instanceof api.ErroCorreios ? e.message : "Não foi possível consultar os Correios. Tente novamente." };
    }
  });

export const correiosRastro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { codigo: string }) => {
    if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/i.test((d?.codigo ?? "").trim())) throw new Error("Código de rastreio inválido (ex.: AB123456789BR).");
    return { codigo: d.codigo.trim().toUpperCase() };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirMaster(c);
    const { rastro } = await import("./api.server");
    return rastro(data.codigo);
  });
