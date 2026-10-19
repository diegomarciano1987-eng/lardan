/** Traduz falhas técnicas do envio ao Asaas para frases que a equipe de cobrança entende. */
const REGRAS: [RegExp, string][] = [
  [/cpf|cnpj|cpfCnpj/i, "A pessoa está sem CPF/CNPJ válido no cadastro. Corrija o cadastro e tente de novo."],
  [/sem permiss|permission|not allowed|42501/i, "Seu usuário não tem permissão para enviar cobranças ao Asaas."],
  [/indispon|desligad|suspens|segredo|ambiente/i, "A conta Asaas está indisponível no momento. Avise o financeiro."],
  [/j[aá] (existe|possui)|aberta|duplic|reaproveit/i, "Já existe uma cobrança aberta no Asaas para esta dívida."],
  [/vencid|due ?date|data/i, "A data de vencimento é inválida (passada ou fora do permitido pelo Asaas)."],
  [/saldo|quitad|paga|valor/i, "A dívida não tem saldo a cobrar (já paga ou valor inválido)."],
  [/cancelad|exclu|not found|não encontrad/i, "O acordo ou a dívida foi cancelado/excluído antes do envio."],
  [/timeout|fetch|network|rede|ECONN|5\d\d/i, "O Asaas não respondeu a tempo. Tente de novo em alguns minutos."],
];

export function erroAmigavel(bruto: string | undefined | null): string {
  const t = String(bruto ?? "").trim();
  if (!t) return "Motivo não informado pelo Asaas.";
  for (const [re, frase] of REGRAS) if (re.test(t)) return frase;
  return `Não foi possível enviar: ${t.slice(0, 160)}`;
}
