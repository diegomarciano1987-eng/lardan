/**
 * LARDAN — disparo do aviso de nova candidatura para os aparelhos da equipe.
 *
 * Aparelho que o navegador já descartou (404/410) é removido na hora, para o
 * registro nunca acumular lixo.
 */
import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";

export interface AvisoPush {
  titulo: string;
  corpo: string;
  url?: string;
  tag?: string;
}

export interface ResultadoEnvio {
  enviados: number;
  removidos: number;
  falhas: { endpoint: string; status: number; corpo: string }[];
}

interface LinhaInscricao {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function enviarAvisoPush(
  aviso: AvisoPush,
  filtroUsuario?: string,
): Promise<ResultadoEnvio> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let consulta = supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");
  if (filtroUsuario) consulta = consulta.eq("user_id", filtroUsuario);

  const { data, error } = await consulta;
  if (error) throw new Error(error.message);

  const inscricoes = (data ?? []) as LinhaInscricao[];
  const vapid = {
    subject: "mailto:lardansemijoias@gmail.com",
    publicKey: process.env["VAPID_PUBLIC_KEY"],
    privateKey: process.env["VAPID_PRIVATE_KEY"],
  };

  const resultado: ResultadoEnvio = { enviados: 0, removidos: 0, falhas: [] };
  const expirados: string[] = [];

  for (const linha of inscricoes) {
    const assinatura: PushSubscription = {
      endpoint: linha.endpoint,
      expirationTime: null,
      keys: { p256dh: linha.p256dh, auth: linha.auth },
    };

    try {
      const payload = await buildPushPayload(
        {
          data: {
            titulo: aviso.titulo,
            corpo: aviso.corpo,
            url: aviso.url ?? "/admin/candidaturas",
            tag: aviso.tag ?? "lardan-candidatura",
          },
        },
        assinatura,
        vapid,
      );
      const resposta = await fetch(linha.endpoint, {
        method: payload.method,
        headers: payload.headers,
        body: payload.body as BodyInit,
      });

      if (resposta.ok) {
        resultado.enviados += 1;
        continue;
      }
      const corpo = (await resposta.text()).slice(0, 300);
      if (resposta.status === 404 || resposta.status === 410) {
        expirados.push(linha.id);
      } else {
        resultado.falhas.push({ endpoint: linha.endpoint, status: resposta.status, corpo });
      }
    } catch (erro) {
      resultado.falhas.push({
        endpoint: linha.endpoint,
        status: 0,
        corpo: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  if (expirados.length > 0) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", expirados);
    resultado.removidos = expirados.length;
  }

  if (resultado.enviados > 0) {
    await supabaseAdmin
      .from("push_subscriptions")
      .update({ last_used_at: new Date().toISOString() })
      .in(
        "id",
        inscricoes.filter((i) => !expirados.includes(i.id)).map((i) => i.id),
      );
  }

  return resultado;
}
