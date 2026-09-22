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
    email: z.string().trim().max(200).optional(),
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
    source: texto(120),
    privacy_version: z.string().trim().min(1).max(60),
    marketing_consent: z.boolean().optional(),
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
    const { createClient } = await import("@supabase/supabase-js");

    const req = getRequest();
    const headers = req.headers;
    const ip = ipDaRequisicao(headers);
    const userAgent = (headers.get("user-agent") ?? "").slice(0, 500);

    const chave = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const cliente = createClient(process.env["SUPABASE_URL"]!, chave, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (chave.startsWith("sb_") && h.get("Authorization") === `Bearer ${chave}`) {
            h.delete("Authorization");
          }
          h.set("apikey", chave);
          return fetch(input, { ...init, headers: h });
        },
      },
    });

    const { data: resultado, error } = await cliente.rpc("submit_candidatura", {
      _payload: data.payload,
      _tracking: { ...data.tracking, ip, user_agent: userAgent },
    });

    if (error) {
      const codigo = error.message.includes("limite_envios")
        ? "limite_envios"
        : error.message.includes("email_invalido")
          ? "email_invalido"
          : "falha";
      return { status: "erro" as const, codigo };
    }
    const r = resultado as { protocol: string; duplicate: boolean };

    // Avisos internos: nunca derrubam o envio da candidata se falharem.
    try {
      const { avisarNovaCandidatura } = await import("./avisos.server");
      await avisarNovaCandidatura({
        protocolo: r.protocol,
        nome: data.payload.full_name,
        cidade: data.payload.city,
        uf: data.payload.uf,
        whatsapp: data.payload.whatsapp,
        email: data.payload.email ?? null,
        reenvio: r.duplicate,
      });
    } catch (falha) {
      console.error("[candidatura] aviso interno falhou:", falha);
    }

    return { status: "ok" as const, protocolo: r.protocol, reenvio: r.duplicate };
  });
