/**
 * LARDAN — contratos canônicos dos campos brasileiros.
 *
 * Este é o ÚNICO lugar onde vivem máscara, limite, normalização e validação de
 * CPF, CNPJ (numérico e alfanumérico), CEP, telefone/WhatsApp, e-mail, PIX e
 * códigos internos. Cliente e servidor importam daqui; o banco replica as
 * mesmas regras em constraints. Nenhuma tela pode ter sua própria versão.
 *
 * Limite honesto: validação estrutural prova apenas coerência de formato e
 * dígitos verificadores. Não prova titularidade, existência nem regularidade.
 */

export type EstadoCampo =
  | "vazio"
  | "incompleto"
  | "invalido"
  | "valido";

export interface Canonico {
  /** valor canônico para gravar (ou null quando vazio) */
  canonico: string | null;
  /** valor formatado para exibir enquanto digita */
  formatado: string;
  estado: EstadoCampo;
  /** mensagem em português, pronta para o usuário */
  erro: string | null;
}

export const somenteDigitos = (v: string | null | undefined) =>
  (v ?? "").replace(/\D/g, "");

const vazio = (formatado = ""): Canonico => ({
  canonico: null,
  formatado,
  estado: "vazio",
  erro: null,
});

/* ------------------------------------------------------------------ CPF -- */

export const CPF_TAMANHO = 11;
export const CPF_MAXLENGTH = 14; // 000.000.000-00

export function cpfValido(v: string | null | undefined) {
  const d = somenteDigitos(v);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  const dv = (fim: number) => {
    let soma = 0;
    for (let i = 0; i < fim; i++) soma += Number(d[i]) * (fim + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function formatarCpf(v: string | null | undefined) {
  const d = somenteDigitos(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function normalizarCpf(entrada: string): Canonico {
  const d = somenteDigitos(entrada).slice(0, 11);
  if (!d) return vazio();
  const formatado = formatarCpf(d);
  if (d.length < 11)
    return { canonico: null, formatado, estado: "incompleto", erro: "CPF incompleto: faltam dígitos." };
  if (!cpfValido(d))
    return {
      canonico: null,
      formatado,
      estado: "invalido",
      erro: "CPF inválido: os dígitos verificadores não conferem.",
    };
  return { canonico: d, formatado, estado: "valido", erro: null };
}

/* ----------------------------------------------------------------- CNPJ -- */

export const CNPJ_TAMANHO = 14;
export const CNPJ_MAXLENGTH = 18; // 00.000.000/0000-00

/** Caracteres previstos: dígitos e letras maiúsculas (sem I, O, Q, U não é regra oficial — a Receita usa 0-9 e A-Z). */
const CNPJ_PERMITIDO = /[^0-9A-Z]/g;

export function limparCnpj(v: string | null | undefined) {
  return (v ?? "").toUpperCase().replace(CNPJ_PERMITIDO, "");
}

const valorCaractere = (c: string) => c.charCodeAt(0) - 48;

/**
 * Dígitos verificadores do CNPJ conforme especificação vigente (2026):
 * as 12 primeiras posições podem ser alfanuméricas; o valor de cada caractere
 * é o código ASCII menos 48. Os 2 verificadores são sempre numéricos.
 */
export function cnpjValido(v: string | null | undefined) {
  const c = limparCnpj(v);
  if (c.length !== 14) return false;
  const base = c.slice(0, 12);
  const dvs = c.slice(12);
  if (!/^[0-9]{2}$/.test(dvs)) return false;
  if (!/^[0-9A-Z]{12}$/.test(base)) return false;
  // sequências evidentemente inválidas (todos os caracteres iguais)
  if (/^(.)\1{13}$/.test(c)) return false;

  const calc = (tamanho: number) => {
    const pesos =
      tamanho === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += valorCaractere(c[i] as string) * (pesos[i] as number);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(dvs[0]) && calc(13) === Number(dvs[1]);
}

export function formatarCnpj(v: string | null | undefined) {
  const c = limparCnpj(v).slice(0, 14);
  if (c.length <= 2) return c;
  if (c.length <= 5) return `${c.slice(0, 2)}.${c.slice(2)}`;
  if (c.length <= 8) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5)}`;
  if (c.length <= 12) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8)}`;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export function cnpjAlfanumerico(v: string | null | undefined) {
  return /[A-Z]/.test(limparCnpj(v));
}

export function normalizarCnpj(entrada: string): Canonico {
  const c = limparCnpj(entrada).slice(0, 14);
  if (!c) return vazio();
  const formatado = formatarCnpj(c);
  if (c.length < 14)
    return { canonico: null, formatado, estado: "incompleto", erro: "CNPJ incompleto: faltam caracteres." };
  if (!/^[0-9]{2}$/.test(c.slice(12)))
    return {
      canonico: null,
      formatado,
      estado: "invalido",
      erro: "CNPJ inválido: os dois últimos caracteres precisam ser números.",
    };
  if (!cnpjValido(c))
    return {
      canonico: null,
      formatado,
      estado: "invalido",
      erro: "CNPJ inválido: os dígitos verificadores não conferem.",
    };
  return { canonico: c, formatado, estado: "valido", erro: null };
}

/* -------------------------------------------------- documento (CPF/CNPJ) -- */

export type TipoDocumento = "cpf" | "cnpj" | "indefinido";

export function tipoDocumento(v: string | null | undefined): TipoDocumento {
  const c = limparCnpj(v);
  if (!c) return "indefinido";
  if (/[A-Z]/.test(c)) return "cnpj";
  return c.length > 11 ? "cnpj" : "cpf";
}

/** Campo único que aceita CPF ou CNPJ e decide pelo conteúdo. */
export function normalizarDocumento(entrada: string, forcar?: TipoDocumento): Canonico {
  const tipo = forcar && forcar !== "indefinido" ? forcar : tipoDocumento(entrada);
  if (tipo === "cnpj") return normalizarCnpj(entrada);
  const bruto = somenteDigitos(entrada);
  if (bruto.length > 11) return normalizarCnpj(entrada);
  return normalizarCpf(entrada);
}

export function formatarDocumento(v: string | null | undefined) {
  return tipoDocumento(v) === "cnpj" ? formatarCnpj(v) : formatarCpf(v);
}

/** Exibição mascarada — padrão para quem não tem permissão de ver o número. */
export function mascararDocumento(v: string | null | undefined) {
  const c = limparCnpj(v);
  if (!c) return "—";
  if (c.length === 11) return `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**`;
  if (c.length === 14) return `**.${c.slice(2, 5)}.${c.slice(5, 8)}/****-**`;
  return `${"*".repeat(Math.max(c.length - 4, 0))}${c.slice(-4)}`;
}

/* ------------------------------------------------------------------ CEP -- */

export const CEP_MAXLENGTH = 9; // 00000-000

export function formatarCep(v: string | null | undefined) {
  const d = somenteDigitos(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function normalizarCep(entrada: string): Canonico {
  const d = somenteDigitos(entrada).slice(0, 8);
  if (!d) return vazio();
  const formatado = formatarCep(d);
  if (d.length < 8)
    return { canonico: null, formatado, estado: "incompleto", erro: "CEP incompleto: são 8 dígitos." };
  return { canonico: d, formatado, estado: "valido", erro: null };
}

/* ------------------------------------------------------------- telefone -- */

export const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68,
  69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95,
  96, 97, 98, 99,
]);

export const WHATSAPP_MAXLENGTH = 15; // (00) 90000-0000
export const TELEFONE_MAXLENGTH = 15;

/** Remove o país colado (+55 / 55) sem duplicar quando o usuário cola E.164. */
export function digitosNacionais(entrada: string) {
  let d = somenteDigitos(entrada);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d.slice(0, 11);
}

export function formatarTelefone(v: string | null | undefined) {
  const d = digitosNacionais(v ?? "");
  if (d.length <= 2) return d ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export const paraE164 = (digitos: string) => `+55${digitos}`;

export function deE164(v: string | null | undefined) {
  return formatarTelefone(v ?? "");
}

/** WhatsApp: só celular brasileiro — DDD válido + 9 dígitos começando em 9. */
export function normalizarWhatsapp(entrada: string): Canonico {
  const d = digitosNacionais(entrada);
  if (!d) return vazio();
  const formatado = formatarTelefone(d);
  if (d.length < 11)
    return { canonico: null, formatado, estado: "incompleto", erro: "WhatsApp incompleto: DDD + 9 dígitos." };
  if (!DDDS_VALIDOS.has(Number(d.slice(0, 2))))
    return { canonico: null, formatado, estado: "invalido", erro: "DDD inexistente no Brasil." };
  if (d[2] !== "9")
    return {
      canonico: null,
      formatado,
      estado: "invalido",
      erro: "WhatsApp precisa ser celular: o número começa com 9.",
    };
  return { canonico: paraE164(d), formatado, estado: "valido", erro: null };
}

/** Telefone alternativo: aceita fixo (8) e celular (9). */
export function normalizarTelefone(entrada: string): Canonico {
  const d = digitosNacionais(entrada);
  if (!d) return vazio();
  const formatado = formatarTelefone(d);
  if (d.length < 10)
    return { canonico: null, formatado, estado: "incompleto", erro: "Telefone incompleto: DDD + número." };
  if (!DDDS_VALIDOS.has(Number(d.slice(0, 2))))
    return { canonico: null, formatado, estado: "invalido", erro: "DDD inexistente no Brasil." };
  if (d.length === 11 && d[2] !== "9")
    return {
      canonico: null,
      formatado,
      estado: "invalido",
      erro: "Número de 9 dígitos precisa começar com 9.",
    };
  if (d.length === 10 && !/[2-5]/.test(d[2] as string))
    return {
      canonico: null,
      formatado,
      estado: "invalido",
      erro: "Telefone fixo inválido para este DDD.",
    };
  return { canonico: paraE164(d), formatado, estado: "valido", erro: null };
}

/* --------------------------------------------------------------- e-mail -- */

export const EMAIL_MAXLENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizarEmail(entrada: string): Canonico {
  const limpo = entrada.trim().replace(/\s+/g, "");
  if (!limpo) return vazio();
  const baixo = limpo.toLowerCase().slice(0, EMAIL_MAXLENGTH);
  if (!EMAIL_RE.test(baixo))
    return { canonico: null, formatado: limpo, estado: "invalido", erro: "E-mail em formato inválido." };
  return { canonico: baixo, formatado: limpo, estado: "valido", erro: null };
}

/* ------------------------------------------------------------------ PIX -- */

export type TipoPix = "cpf" | "cnpj" | "telefone" | "email" | "aleatoria";

export const TIPOS_PIX: { value: TipoPix; label: string }[] = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "telefone", label: "Telefone" },
  { value: "email", label: "E-mail" },
  { value: "aleatoria", label: "Chave aleatória" },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizarPix(tipo: TipoPix, entrada: string): Canonico {
  if (!entrada.trim()) return vazio();
  switch (tipo) {
    case "cpf":
      return normalizarCpf(entrada);
    case "cnpj":
      return normalizarCnpj(entrada);
    case "telefone":
      return normalizarTelefone(entrada);
    case "email":
      return normalizarEmail(entrada);
    case "aleatoria": {
      const v = entrada.trim().toLowerCase();
      return UUID_RE.test(v)
        ? { canonico: v, formatado: v, estado: "valido", erro: null }
        : {
            canonico: null,
            formatado: entrada.trim(),
            estado: "invalido",
            erro: "Chave aleatória precisa estar no formato UUID.",
          };
    }
  }
}

/* ------------------------------------------------ códigos e identidades -- */

export const SKU_MAXLENGTH = 40;

/** SKU/código legado é texto curto controlado — zeros à esquerda preservados. */
export function normalizarCodigo(entrada: string) {
  return entrada
    .toUpperCase()
    .replace(/[^A-Z0-9._-]/g, "")
    .slice(0, SKU_MAXLENGTH);
}

/** EAN-8/12/13/14 com dígito verificador. */
export function codigoBarrasValido(v: string | null | undefined) {
  const d = somenteDigitos(v);
  if (![8, 12, 13, 14].includes(d.length)) return false;
  const corpo = d.slice(0, -1).split("").reverse();
  let soma = 0;
  corpo.forEach((c, i) => (soma += Number(c) * (i % 2 === 0 ? 3 : 1)));
  const dv = (10 - (soma % 10)) % 10;
  return dv === Number(d.slice(-1));
}

export function normalizarCodigoBarras(entrada: string): Canonico {
  const d = somenteDigitos(entrada).slice(0, 14);
  if (!d) return vazio();
  if (![8, 12, 13, 14].includes(d.length))
    return { canonico: null, formatado: d, estado: "incompleto", erro: "Código de barras deve ter 8, 12, 13 ou 14 dígitos." };
  if (!codigoBarrasValido(d))
    return { canonico: null, formatado: d, estado: "invalido", erro: "Dígito verificador do código de barras não confere." };
  return { canonico: d, formatado: d, estado: "valido", erro: null };
}

/* ------------------------------------------------------------- endereço -- */

export const LIMITES_ENDERECO = {
  street: 120,
  street_number: 12,
  complement: 80,
  district: 80,
  city: 80,
  reference: 160,
} as const;
