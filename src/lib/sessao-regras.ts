/**
 * Regras puras da sessão estável (0358): ninguém da equipe cai do sistema por
 * oscilação de internet ou por voltar para a aba. Só sai quem saiu de verdade.
 */

type ErroLogin = { name?: unknown; status?: unknown; message?: unknown } | null | undefined;

/** Falha de rede/servidor momentânea: não prova que a pessoa saiu, então não derruba a tela. */
export function falhaPassageira(erro: ErroLogin): boolean {
  if (!erro) return false;
  const nome = String(erro.name ?? "");
  if (nome === "AuthSessionMissingError" || nome === "AuthInvalidJwtError") return false;
  if (nome === "AuthRetryableFetchError") return true;
  const status = typeof erro.status === "number" ? erro.status : undefined;
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  if (status === undefined || status === 0) {
    return /fetch|network|rede|timeout|aborted|internet|load failed/i.test(String(erro.message ?? ""));
  }
  return false;
}

/**
 * Decide se um aviso do login deve recarregar telas e permissões.
 * O login reenvia "SIGNED_IN" toda vez que a aba volta ao foco, com a MESMA pessoa:
 * isso não pode recarregar nada. Só troca real de pessoa, saída ou dados alterados recarregam.
 * anterior: undefined = ainda não sabemos quem estava (comportamento antigo: recarrega).
 */
export function deveRecarregarSessao(evento: string, anterior: string | null | undefined, atual: string | null): boolean {
  if (evento === "SIGNED_OUT" || evento === "USER_UPDATED") return true;
  if (evento === "SIGNED_IN") return anterior === undefined || anterior !== atual;
  return false;
}

/**
 * Permissões de tela: depois de lidas uma vez, uma releitura que falhe mantém a última
 * resposta boa (o banco continua validando cada ação). Só sem nenhuma resposta ainda é
 * que a tela mostra "conexão instável" — nunca "acesso não liberado" por falha de rede.
 */
export function estadoPermissao(consultas: { data: unknown; isError: boolean }[]): "pronto" | "carregando" | "instavel" {
  if (consultas.every((c) => c.data !== undefined)) return "pronto";
  if (consultas.some((c) => c.data === undefined && c.isError)) return "instavel";
  return "carregando";
}
