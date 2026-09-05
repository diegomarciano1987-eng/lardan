/**
 * CPF e CNPJ — tudo local, sem nenhuma consulta externa.
 * A validação é apenas estrutural (dígitos verificadores). Ela NUNCA prova
 * que o documento pertence à pessoa nem que a empresa está ativa.
 */

export type DocEstado =
  | "nao_informado"
  | "invalido"
  | "estruturalmente_valido"
  | "duplicado";

export const DOC_ESTADO_LABEL: Record<DocEstado, string> = {
  nao_informado: "Não informado",
  invalido: "Inválido",
  estruturalmente_valido: "Estruturalmente válido",
  duplicado: "Possível duplicidade",
};

export const onlyDigits = (v: string | null | undefined) =>
  (v ?? "").replace(/\D/g, "");

export function normalizeCpf(v: string | null | undefined) {
  const d = onlyDigits(v);
  return d.length === 11 ? d : d;
}

export function isValidCpf(v: string | null | undefined) {
  const d = onlyDigits(v);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  const calc = (fim: number) => {
    let soma = 0;
    for (let i = 0; i < fim; i++) soma += Number(d[i]) * (fim + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function isValidCnpj(v: string | null | undefined) {
  const d = onlyDigits(v);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const calc = (fim: number) => {
    const pesos = fim === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < fim; i++) soma += Number(d[i]) * (pesos[i] as number);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function formatDoc(v: string | null | undefined) {
  const d = onlyDigits(v);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return v ?? "";
}

/** Exibição mascarada: padrão para quem não tem permissão de ver o número. */
export function maskDoc(v: string | null | undefined) {
  const d = onlyDigits(v);
  if (!d) return "—";
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/****-**`;
  return `${"*".repeat(Math.max(d.length - 4, 0))}${d.slice(-4)}`;
}

export function docEstado(v: string | null | undefined, duplicado = false): DocEstado {
  const d = onlyDigits(v);
  if (!d) return "nao_informado";
  if (duplicado) return "duplicado";
  if (d.length === 11) return isValidCpf(d) ? "estruturalmente_valido" : "invalido";
  if (d.length === 14) return isValidCnpj(d) ? "estruturalmente_valido" : "invalido";
  return "invalido";
}

/** Máscara progressiva enquanto digita. */
export function maskDocInput(v: string) {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function maskPhoneInput(v: string) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}

export function maskCepInput(v: string) {
  return onlyDigits(v).slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}
