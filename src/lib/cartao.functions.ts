import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Plano = { id: string; codigo: string; nome: string; natureza: string };
type Linha = { id: string; descricao: string; valor_cents: number; chart_account_id: string | null };

const chave = (d: string) =>
  d
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\d+\s*\/\s*\d+\s*$/, "")
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 2)
    .join(" ");

/**
 * Sugere categoria para os gastos sem classificação de uma fatura.
 * 1º aprende com gastos já classificados (mesmo início de descrição); 2º pergunta à IA.
 * Grava pela RPC oficial (valida natureza, audita). Nunca fecha a fatura.
 */
export const categorizarFatura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { fatura_id: string }) => {
    if (!d?.fatura_id || !/^[0-9a-f-]{36}$/i.test(d.fatura_id)) throw new Error("Fatura inválida");
    return d;
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: pode } = await sb.rpc("has_capability" as never, { _user_id: context.userId, _cap: "finance.payable.manage" } as never);
    if (pode !== true) return { ok: false as const, erro: "Sem permissão para classificar gastos." };

    const det = await sb.rpc("fin_cartao_fatura_detalhe" as never, { _fatura: data.fatura_id } as never);
    if (det.error) return { ok: false as const, erro: det.error.message };
    const linhas = ((det.data as unknown as { linhas: Linha[] })?.linhas ?? []).filter((l) => !l.chart_account_id);
    if (!linhas.length) return { ok: true as const, historico: 0, ia: 0, restantes: 0 };

    const cls = await sb.rpc("fin_classificacoes" as never, { _filtros: { direction: "payable" } } as never);
    if (cls.error) return { ok: false as const, erro: cls.error.message };
    const planos = ((cls.data as unknown as { planos: Plano[] })?.planos ?? []).filter((p) =>
      ["custo", "despesa", "passivo"].includes(p.natureza),
    );
    const porCodigo = new Map(planos.map((p) => [p.codigo, p]));
    const validos = new Set(planos.map((p) => p.id));

    // 1) Histórico: gastos já classificados manualmente/por histórico com o mesmo início de descrição
    const hist = await sb
      .from("fin_cartao_lancamentos" as never)
      .select("descricao, chart_account_id, classificado_por")
      .not("chart_account_id", "is", null)
      .in("classificado_por", ["manual", "historico"])
      .order("updated_at", { ascending: false })
      .limit(2000);
    const aprendido = new Map<string, string>();
    for (const h of (hist.data ?? []) as unknown as { descricao: string; chart_account_id: string }[]) {
      const k = chave(h.descricao);
      if (k && !aprendido.has(k) && validos.has(h.chart_account_id)) aprendido.set(k, h.chart_account_id);
    }
    const itens: { id: string; chart_account_id: string; origem: string; confianca: number; motivo: string }[] = [];
    const paraIa: Linha[] = [];
    for (const l of linhas) {
      const c = aprendido.get(chave(l.descricao));
      if (c) itens.push({ id: l.id, chart_account_id: c, origem: "historico", confianca: 1, motivo: "Mesmo estabelecimento já classificado antes" });
      else paraIa.push(l);
    }

    // 2) IA (Lovable AI) para o restante
    let ia = 0;
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (paraIa.length && apiKey && planos.length) {
      const listaPlanos = planos.map((p) => `${p.codigo} ${p.nome} (${p.natureza})`).join("\n");
      for (let i = 0; i < paraIa.length; i += 60) {
        const lote = paraIa.slice(i, i + 60);
        const resp = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
          method: "POST",
          headers: { "Lovable-API-Key": apiKey, Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
          body: JSON.stringify({
            model: "openai/gpt-6-astra",
            stream: true,
            store: false,
            reasoning: { effort: "low" },
            instructions:
              "Você classifica gastos de cartão de crédito corporativo da Lardan (fábrica e revenda de semijoias, com consultoras e representantes) no plano de contas abaixo. Use SOMENTE códigos da lista. Se não houver pista suficiente, use a conta 'Outras...' mais próxima e confiança baixa (<0.5). Não invente. Responda um item por gasto, motivo curto (até 12 palavras).\n\nPlano de contas:\n" +
              listaPlanos,
            input: lote.map((l, n) => `${n}|${l.descricao}|R$ ${(l.valor_cents / 100).toFixed(2)}`).join("\n"),
            text: {
              format: {
                type: "json_schema",
                name: "classificacao",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["itens"],
                  properties: {
                    itens: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["indice", "codigo", "confianca", "motivo"],
                        properties: {
                          indice: { type: "integer" },
                          codigo: { type: "string" },
                          confianca: { type: "number" },
                          motivo: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          }),
        });
        if (resp.status === 429) return { ok: false as const, erro: "Muitas solicitações à IA agora. Tente em 1 minuto." };
        if (resp.status === 402) return { ok: false as const, erro: "Créditos de IA esgotados no workspace." };
        if (!resp.ok || !resp.body) return { ok: false as const, erro: `IA indisponível (${resp.status}).` };
        let texto = "";
        const leitor = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await leitor.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i2: number;
          while ((i2 = buf.indexOf("\n")) >= 0) {
            const linha = buf.slice(0, i2).trim();
            buf = buf.slice(i2 + 1);
            if (!linha.startsWith("data:")) continue;
            const corpo = linha.slice(5).trim();
            if (!corpo || corpo === "[DONE]") continue;
            try {
              const ev = JSON.parse(corpo) as { type?: string; delta?: string };
              if (ev.type === "response.output_text.delta" && ev.delta) texto += ev.delta;
            } catch {
              /* evento parcial */
            }
          }
        }
        let saida: { indice: number; codigo: string; confianca: number; motivo: string }[] = [];
        try {
          saida = (JSON.parse(texto || "{}") as { itens?: typeof saida }).itens ?? [];
        } catch {
          saida = [];
        }
        for (const s of saida) {
          const l = lote[s.indice];
          const p = porCodigo.get(String(s.codigo).trim().split(" ")[0] ?? "");
          if (!l || !p) continue;
          itens.push({
            id: l.id,
            chart_account_id: p.id,
            origem: "ia",
            confianca: Math.max(0, Math.min(1, Number(s.confianca) || 0)),
            motivo: String(s.motivo ?? "").slice(0, 200),
          });
          ia++;
        }
      }
    }

    if (itens.length) {
      const r = await sb.rpc("fin_cartao_classificar" as never, {
        _itens: itens.map((x) => ({ ...x, cost_center_id: null })),
      } as never);
      if (r.error) return { ok: false as const, erro: r.error.message };
    }
    return {
      ok: true as const,
      historico: itens.length - ia,
      ia,
      restantes: linhas.length - itens.length,
      semChave: !apiKey,
    };
  });
