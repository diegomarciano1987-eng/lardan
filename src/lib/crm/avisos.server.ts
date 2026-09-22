/**
 * LARDAN — avisos internos quando entra uma candidatura nova pelo site.
 *
 * Duas frentes, independentes: o aviso no navegador (celular/computador) da
 * equipe e o e-mail para a caixa oficial. Uma falha nunca cancela a outra nem
 * afeta a candidata.
 */
import { enviarAvisoPush } from "@/lib/push/notificar.server";

export const EMAIL_INTERNO = "lardansemijoias@gmail.com";

export interface NovaCandidatura {
  protocolo: string;
  nome: string;
  cidade: string;
  uf: string;
  whatsapp: string;
  email: string | null;
  reenvio: boolean;
}

export async function avisarNovaCandidatura(c: NovaCandidatura) {
  const titulo = c.reenvio ? "Candidatura reenviada" : "Nova candidatura Lardan";
  const corpo = `${c.nome} — ${c.cidade}/${c.uf} · protocolo ${c.protocolo}`;

  const [push, email] = await Promise.allSettled([
    enviarAvisoPush({ titulo, corpo, url: "/admin/candidaturas", tag: `cand-${c.protocolo}` }),
    enviarEmailInterno(c),
  ]);

  return {
    push: push.status === "fulfilled" ? push.value : { erro: String(push.reason) },
    email: email.status === "fulfilled" ? email.value : { erro: String(email.reason) },
  };
}

/** Envio do e-mail interno (ligado assim que o domínio de e-mail estiver pronto). */
async function enviarEmailInterno(_c: NovaCandidatura) {
  return { sent: false, reason: "email_nao_configurado" as const };
}
