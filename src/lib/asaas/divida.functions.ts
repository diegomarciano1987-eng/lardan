/**
 * 22/11 — Dívida de consultora/cliente:
 *  - liquidarDivida: apaga a dívida (título inteiro ou uma parcela) com motivo e registro de quem fez;
 *    cobrança aberta no Asaas é cancelada NA HORA (a varredura de 1 minuto continua como rede de segurança).
 *  - reconferirTituloAsaas: relê no Asaas as cobranças do título, atualiza o espelho e, se já foram pagas lá,
 *    lança a baixa pelo motor oficial (uma cobrança = um lançamento).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Ctx = { supabase: { rpc: Rpc }; userId: string };
const UUID = /^[0-9a-f-]{36}$/i;

export type ResultadoLiquidar = {
  modo: "cancelado" | "abatido" | "ja_liquidada";
  valor_cents: number;
  numero: string | null;
  asaas: { external_id: string | null; resultado: "cancelada" | "ja_excluida" | "paga_no_asaas" | "falhou"; erro: string | null }[];
};

export const liquidarDivida = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { titleId: string; installmentId?: string | null; motivo: string }) => {
    if (!UUID.test(d?.titleId ?? "")) throw new Error("Título inválido.");
    if (d.installmentId && !UUID.test(d.installmentId)) throw new Error("Parcela inválida.");
    const motivo = (d.motivo ?? "").trim();
    if (motivo.length < 5) throw new Error("Escreva o motivo (mínimo 5 letras).");
    return { titleId: d.titleId, installmentId: d.installmentId ?? null, motivo: motivo.slice(0, 300) };
  })
  .handler(async ({ data, context }): Promise<ResultadoLiquidar> => {
    const c = context as unknown as Ctx;
    // a rotina confere a permissão com a sessão da própria pessoa e grava quem fez
    const r = await c.supabase.rpc("fin_divida_liquidar", { _title: data.titleId, _installment: data.installmentId, _motivo: data.motivo });
    if (r.error) throw new Error(r.error.message);
    const d = r.data as { modo: ResultadoLiquidar["modo"]; valor_cents: number; numero: string | null; cobrancas: { id: string }[] };
    const asaas: ResultadoLiquidar["asaas"] = [];
    if (d.cobrancas?.length) {
      const { cancelarCobrancaComRegistro } = await import("./cancelar.server");
      for (const cob of d.cobrancas) {
        const x = await cancelarCobrancaComRegistro(cob.id, c.userId, `Dívida liquidada: ${data.motivo}`);
        asaas.push({ external_id: x.external_id, resultado: x.resultado, erro: x.erro });
      }
    }
    return { modo: d.modo, valor_cents: Number(d.valor_cents ?? 0), numero: d.numero ?? null, asaas };
  });

export type CobrancaReconferida = {
  external_id: string;
  valor_cents: number;
  antes: string | null;
  agora: string;
  pagamento: string | null;
  baixa: "lancada" | "ja_lancada" | "nao" | null;
  motivo: string | null;
};

export const reconferirTituloAsaas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { titleId: string }) => {
    if (!UUID.test(d?.titleId ?? "")) throw new Error("Título inválido.");
    return { titleId: d.titleId };
  })
  .handler(async ({ data, context }): Promise<{ cobrancas: CobrancaReconferida[] }> => {
    const c = context as unknown as Ctx;
    const pode = await c.supabase.rpc("asaas_eu_posso", { _cap: "finance.receivable.manage" });
    if (pode.error || !pode.data) throw new Error("Sem acesso ao financeiro para reconferir no Asaas.");
    const podeBaixar = await c.supabase.rpc("asaas_eu_posso", { _cap: "finance.settlement.create" });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { CONTA_PRODUCAO, releCobrancasProducao } = await import("./espelho.server");
    const { data: parcelas, error: ep } = await supabaseAdmin.from("financial_installments").select("id").eq("title_id", data.titleId);
    if (ep) throw new Error(ep.message);
    const ids = (parcelas ?? []).map((p) => p.id);
    const { data: cobs, error: ec } = await supabaseAdmin
      .from("asaas_charges")
      .select("id, external_id, external_status, account_id")
      .or(`title_id.eq.${data.titleId}${ids.length ? `,installment_id.in.(${ids.join(",")})` : ""}`);
    if (ec) throw new Error(ec.message);
    const lista = (cobs ?? []).filter((x) => x.account_id === CONTA_PRODUCAO);
    if (!lista.length) return { cobrancas: [] };

    const relidas = await releCobrancasProducao(lista.map((x) => x.external_id));
    const out: CobrancaReconferida[] = [];
    for (const r of relidas) {
      const orig = lista.find((x) => x.external_id === r.external_id);
      let baixa: CobrancaReconferida["baixa"] = null;
      let motivo: string | null = null;
      if (orig && (r.status === "RECEIVED" || r.status === "CONFIRMED") && podeBaixar.data) {
        const b = await (supabaseAdmin.rpc as unknown as Rpc)("asaas_baixa_automatica", { _charge: orig.id });
        if (b.error) { baixa = "nao"; motivo = b.error.message.slice(0, 200); }
        else {
          const j = (b.data ?? {}) as { baixa?: boolean; motivo?: string; repetido?: boolean };
          baixa = j.baixa ? (j.repetido ? "ja_lancada" : "lancada") : (j.motivo === "ja_baixada_pelo_asaas" || j.motivo === "parcela_ja_quitada" ? "ja_lancada" : "nao");
          motivo = j.motivo ?? null;
        }
      }
      out.push({ external_id: r.external_id, valor_cents: r.valor_cents, antes: orig?.external_status ?? null, agora: r.status, pagamento: r.pagamento, baixa, motivo });
    }
    return { cobrancas: out };
  });
