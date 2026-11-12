/**
 * 0300 (Diego, 12/11/2026): nenhum aviso aparece em inglês para quem usa a Lardan.
 * Mensagens que chegam de fora (navegador, login, banco, ZapSign, Asaas, Correios…) em inglês
 * viram um texto curto em português. Textos já em português passam sem mudança.
 */
const REGRAS: [RegExp, string][] = [
  [/failed to fetch|load failed|networkerror|network request failed|network error|err_internet|err_network|fetch failed|the internet connection appears to be offline/i,
    "Sem conexão com a internet agora. Confira o sinal e tente de novo."],
  [/jwt expired|invalid refresh token|refresh token not found|auth session missing|session.*(expired|not found)|not authenticated|invalid jwt|token.*expired/i,
    "Sua sessão expirou. Entre de novo para continuar."],
  [/invalid login credentials/i, "E-mail ou senha incorretos."],
  [/email not confirmed/i, "Confirme seu e-mail antes de entrar."],
  [/user already registered|already been registered/i, "Este e-mail já tem cadastro."],
  [/password should be|weak password/i, "A senha é fraca. Use pelo menos 8 caracteres, com letras e números."],
  [/rate limit|too many requests|\b429\b/i, "Muitas tentativas seguidas. Aguarde um minuto e tente de novo."],
  [/permission denied|row-level security|violates row level|not allowed|forbidden|unauthorized|\b40[13]\b/i,
    "Você não tem permissão para esta ação."],
  [/duplicate key value|already exists|unique constraint/i, "Este registro já existe."],
  [/violates foreign key/i, "Este registro está ligado a outro e não pode ser alterado assim."],
  [/violates not-null|null value in column/i, "Falta preencher um campo obrigatório."],
  [/violates check constraint|invalid input syntax|invalid input value/i, "Algum valor informado não é válido. Confira e tente de novo."],
  [/statement timeout|canceling statement|timed? ?out|deadline exceeded|\b504\b/i, "Demorou demais para responder. Tente de novo em instantes."],
  [/could not serialize|deadlock|concurrent update/i, "Outra pessoa alterou isto ao mesmo tempo. Tente de novo."],
  [/not found|\b404\b/i, "Não encontrado. Atualize a tela e tente de novo."],
  [/internal server error|bad gateway|service unavailable|\b50[0-3]\b|server error/i, "O servidor não respondeu agora. Tente de novo em instantes."],
  [/unexpected token|is not valid json|json\.parse|unexpected end of json/i, "Resposta inesperada do servidor. Tente de novo."],
  [/aborterror|the user aborted|signal is aborted|aborted/i, "A ação foi interrompida. Tente de novo."],
  [/quota|storage.*full|exceeded the quota/i, "O aparelho está sem espaço para guardar os dados."],
  [/file.*too large|payload too large|\b413\b/i, "O arquivo é grande demais."],
];
const PALAVRAS_EN = /\b(the|failed|error|invalid|unable|cannot|could not|couldn't|request|unexpected|denied|missing|required|please|try again|something went wrong|is not|does not|must be|should be|only|already|undefined|null|object|function|status code|expired|violates|value|column|constraint|token|signer|document|payment|customer)\b/i;
const MARCAS_PT = /[áàâãéêíóôõúç]|\b(não|nao|você|para|com|está|já|uma|ser|foi|tente|confira|falta|erro ao)\b/i;

/** Parece inglês (e não português)? */
export function pareceIngles(t: string): boolean {
  return PALAVRAS_EN.test(t) && !MARCAS_PT.test(t);
}

/** Devolve o texto em português. Português passa intacto; inglês conhecido vira frase pronta; o resto vira aviso genérico. */
export function avisoPt(t: string): string {
  const s = t.trim();
  if (!s) return s;
  if (MARCAS_PT.test(s)) return t;
  for (const [re, pt] of REGRAS) if (re.test(s)) return pt;
  if (!pareceIngles(s)) return t;
  return "Não foi possível concluir agora. Tente de novo; se repetir, avise a Lardan.";
}

/** Mensagem de erro já em português (para avisos e textos de erro na tela). */
export function erroPt(e: unknown, padrao = "Não foi possível concluir agora. Tente de novo."): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
  return m ? avisoPt(m) : padrao;
}
