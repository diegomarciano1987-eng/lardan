/**
 * LARDAN — recebimento da candidatura do site.
 *
 * O envio passa pelo servidor por um motivo de segurança: IP e user-agent são
 * lidos dos cabeçalhos reais da requisição, nunca de um campo enviado pelo
 * navegador. O restante (UTM, referência, idioma) vem do cliente porque só ele
 * conhece esses dados, e é gravado como dado bruto, sem dedução.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const texto = (max: number) => z.string().trim().max(max).optional();

/** Idade completa em anos numa data ISO (AAAA-MM-DD), pelo calendário de São Paulo. */
function idadeEm(iso: string): number | null {
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d) return null;
  const nasc = new Date(Date.UTC(a, m - 1, d));
  if (nasc.getUTCFullYear() !== a || nasc.getUTCMonth() !== m - 1 || nasc.getUTCDate() !== d) return null;
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).split("-").map(Number);
  let idade = hoje[0]! - a;
  if (hoje[1]! < m || (hoje[1] === m && hoje[2]! < d)) idade -= 1;
  return idade < 0 ? null : idade;
}

const Entrada = z.object({
  payload: z.object({
    first_name: z.string().trim().min(2).max(80),
    last_name: z.string().trim().min(2).max(120),
    cpf: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ""))
      .refine((v) => v.length === 11, "cpf_invalido"),
    whatsapp: z.string().trim().min(10).max(32),
    email: z.string().trim().min(5).max(200), // 0395: obrigatório
    city: z.string().trim().min(2).max(120),
    uf: z.string().trim().length(2),
    street: texto(200),
    street_number: texto(20),
    no_number: z.boolean().optional(),
    postal_code: texto(20),
    financial_goal: texto(200),
    availability: texto(200),
    experience: texto(400),
    audience: texto(400),
    motivation: texto(2000),
    dream: z.string().trim().min(2).max(300), // 0395: obrigatório
    dream_value_cents: z.string().regex(/^\d{1,12}$/).optional(),
    source: texto(120),
    privacy_version: z.string().trim().min(1).max(60),
    marketing_consent: z.boolean().optional(),
    // 0159: "Quem te indicou?" (texto livre; pelo link de indicação já vem preenchido)
    quem_indicou: texto(120),
    // 0284: perguntas do teste que ficam no site (R4/R6) e a autorização de contato pelo WhatsApp
    experiencia_venda: z.enum(["vende_hoje", "ja_vendeu", "nunca"]).optional(),
    horas_semana: z.enum(["ate3", "3a6", "7a15", "mais15"]).optional(),
    aceite_contato: z.boolean().optional(),
    // 0394: data de nascimento (regra de crédito por idade). Opcional no servidor para não derrubar páginas antigas em cache.
    data_nascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  tracking: z
    .object({
      landing_page: texto(500),
      referrer: texto(500),
      first_referrer: texto(500),
      first_landing_page: texto(500),
      first_at: texto(40),
      language: texto(20),
      gclid: texto(200),
      fbclid: texto(200),
      msclkid: texto(200),
      indicacao: z.string().trim().regex(/^[a-z0-9]{4,20}$/).optional(),
      representante: z.string().trim().regex(/^lc-\d{6}$/).optional(),
      utm: z.record(z.string(), z.string().max(300)).default({}),
      // Jornada interna de conteúdo: somente caminhos do próprio site e o
      // identificador do CTA editorial. Nenhum dado pessoal.
      jornada: z
        .object({
          first_content_path: texto(200),
          first_content_at: texto(40),
          last_content_path: texto(200),
          last_content_at: texto(40),
          content_paths: z.array(z.string().max(200)).max(8).optional(),
          cta_origin: texto(60),
          cta_destination: texto(200),
          cta_at: texto(40),
        })
        .optional(),
    })
    .default({ utm: {} }),
});

/** Primeiro cabeçalho confiável de IP conforme a infraestrutura (Cloudflare → proxy). */
function ipDaRequisicao(headers: Headers): string | null {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const primeiro = fwd.split(",")[0]?.trim();
    if (primeiro) return primeiro;
  }
  return null;
}

export const enviarCandidatura = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Entrada.parse(data))
  .handler(async ({ data }) => {
    const { getRequest } = await import("@tanstack/react-start/server");

    const req = getRequest();
    const headers = req.headers;
    const ip = ipDaRequisicao(headers);
    const userAgent = (headers.get("user-agent") ?? "").slice(0, 500);

    // 0326: a rotina do banco só aceita o servidor; o IP gravado é o da requisição real.
    const { supabaseAdmin: cliente } = await import("@/integrations/supabase/client.server");

    const { experiencia_venda, horas_semana, aceite_contato, data_nascimento, ...payloadCadastro } = data.payload;
    {
      const idade = idadeEm(data_nascimento);
      if (idade === null || idade > 110) return { status: "erro" as const, codigo: "nascimento_invalido" };
      if (idade < 18) return { status: "erro" as const, codigo: "menor_idade" };
    }
    const { data: resultado, error } = await (cliente as unknown as { rpc: (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }> }).rpc("submit_candidatura", {
      _payload: payloadCadastro,
      _tracking: { ...data.tracking, ip, user_agent: userAgent },
    });

    if (error) {
      const codigo = error.message.includes("limite_envios")
        ? "limite_envios"
        : error.message.includes("email_invalido")
          ? "email_invalido"
          : error.message.includes("cpf_invalido")
            ? "cpf_invalido"
            : "falha";
      return { status: "erro" as const, codigo };
    }
    const r = resultado as { protocol: string; duplicate: boolean };

    // 0394: grava a data de nascimento (nunca derruba o envio se falhar)
    if (data_nascimento) {
      try {
        const { data: lead } = await (cliente as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: { id: string } | null }> } } } })
          .from("leads").select("id").eq("protocol", r.protocol).maybeSingle();
        if (lead?.id) {
          await (cliente as unknown as { rpc: (f: string, a: object) => PromiseLike<unknown> }).rpc("candidatura_nascimento_definir", {
            _lead: lead.id, _data: data_nascimento, _usuario: null,
          });
        }
      } catch (falha) {
        console.error("[candidatura] data de nascimento não gravada:", falha);
      }
    }

    // Avisos internos: nunca derrubam o envio da candidata se falharem.
    try {
      const { avisarNovaCandidatura } = await import("./avisos.server");
      const avisos = avisarNovaCandidatura({
        protocolo: r.protocol,
        nome: `${data.payload.first_name} ${data.payload.last_name}`.trim(),
        cidade: data.payload.city,
        uf: data.payload.uf,
        whatsapp: data.payload.whatsapp,
        email: data.payload.email ?? null,
        reenvio: r.duplicate,
      }).catch((falha) => console.error("[candidatura] aviso interno falhou:", falha));
      // A candidata não espera os avisos além de 2,5 s.
      await Promise.race([avisos, new Promise((ok) => setTimeout(ok, 2500))]);
    } catch (falha) {
      console.error("[candidatura] aviso interno falhou:", falha);
    }

    // 0284: link do teste para responder ali mesmo no site (só candidatura nova e com a autorização marcada).
    let testeToken: string | null = null;
    if (!r.duplicate && aceite_contato) {
      try {
        const { criarTesteDoSite } = await import("@/lib/candidatura-teste/site.server");
        const { ACEITE_TEXTO } = await import("@/lib/candidatura-teste/perguntas");
        testeToken = await criarTesteDoSite(r.protocol, { experiencia_venda, horas_semana }, ACEITE_TEXTO);
      } catch (falha) {
        console.error("[candidatura] teste do site falhou:", falha);
      }
    }

    // 0402: a Lara abre a conversa no WhatsApp (só candidatura nova, com o aceite; só se a Lara estiver ligada).
    if (!r.duplicate && aceite_contato) {
      try {
        const ini = await (cliente as unknown as { rpc: (f: string, a: object) => PromiseLike<{ data: { iniciada?: boolean } | null; error: unknown }> })
          .rpc("lara_iniciar_protocolo", { _protocolo: r.protocol });
        if (ini.data?.iniciada) {
          const { processarFila } = await import("@/lib/lara/fluxo.server");
          await Promise.race([processarFila(3), new Promise((ok) => setTimeout(ok, 3000))]);
        }
      } catch (falha) {
        console.error("[candidatura] Lara não iniciou:", (falha as Error).message);
      }
    }

    return { status: "ok" as const, protocolo: r.protocol, reenvio: r.duplicate, testeToken };
  });
