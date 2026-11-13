/**
 * 0306 — espelho do cadastro Lardan → cliente Asaas (regras puras, sem rede).
 * Lardan manda: campo preenchido no Lardan e diferente no Asaas é enviado.
 * Nunca apaga: o que só o Asaas tem fica lá e aparece como diferença para conferir.
 * CPF diferente nunca é trocado sozinho (identidade): fica para uma pessoa decidir.
 */
export const CAMPOS = ["name", "cpfCnpj", "email", "mobilePhone", "phone", "postalCode", "address", "addressNumber", "complement", "province"] as const;
export type Campo = (typeof CAMPOS)[number];
export type DadosCliente = Partial<Record<Campo, string | null>>;

export const ROTULO: Record<Campo | "avisos", string> = {
  name: "Nome", cpfCnpj: "CPF", email: "E-mail", mobilePhone: "Celular", phone: "Telefone fixo", postalCode: "CEP",
  address: "Rua", addressNumber: "Número", complement: "Complemento", province: "Bairro", avisos: "Avisos do Asaas",
};

export type AcaoDiferenca = "enviar" | "so_no_asaas" | "conferir" | "recusado";
export interface Diferenca { campo: Campo | "avisos"; lardan: string | null; asaas: string | null; acao: AcaoDiferenca; nota?: string }

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const digitos = (s: string) => s.replace(/\D/g, "");

/** Valor comparável (o Asaas guarda maiúsculo, sem acento, celular com 55 etc.). */
export function normalizar(campo: Campo, v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  switch (campo) {
    case "cpfCnpj": case "postalCode": return digitos(s);
    case "mobilePhone": case "phone": {
      let d = digitos(s).replace(/^0+/, "");
      if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
      return d;
    }
    case "email": return s.toLowerCase();
    case "addressNumber": {
      const t = semAcento(s).toUpperCase().replace(/\s+/g, "");
      return /^(S\/?N|SN|SEMNUMERO|SEMN)$/.test(t) ? "S/N" : t;
    }
    default: return semAcento(s).toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  }
}

/** Só manda o que o Asaas aceita: e-mail válido, celular 11 dígitos, fixo 10, CEP 8, CPF/CNPJ 11/14. */
export function valido(campo: Campo, v: string | null | undefined): boolean {
  const n = normalizar(campo, v);
  if (!n) return false;
  switch (campo) {
    case "email": return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(n);
    case "mobilePhone": return /^\d{2}9\d{8}$/.test(n);
    case "phone": return /^\d{2}[2-5]\d{7}$/.test(n);
    case "postalCode": return /^\d{8}$/.test(n);
    case "cpfCnpj": return n.length === 11 || n.length === 14;
    default: return n.length > 0;
  }
}

/** Valor a enviar (formato que o Asaas espera). */
function paraEnvio(campo: Campo, v: string): string {
  if (["cpfCnpj", "postalCode", "mobilePhone", "phone"].includes(campo)) return normalizar(campo, v);
  if (campo === "email") return v.trim().toLowerCase();
  return v.trim().replace(/\s+/g, " ");
}

/** Semelhança 0–1 entre dois textos já normalizados (distância de edição). */
export function semelhanca(a: string, b: string): number {
  if (!a && !b) return 1;
  const m = a.length, n = b.length;
  let ant = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const at = [i];
    for (let j = 1; j <= n; j++) at[j] = Math.min(ant[j]! + 1, at[j - 1]! + 1, ant[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = at;
  }
  return 1 - ant[n]! / Math.max(m, n);
}

export interface OpcoesComparar {
  /** primeira conferência de um cadastro antigo: não sobrescreve contato que o Lardan não conhece (pode ter sido corrigido no Asaas) */
  primeira?: boolean;
  /** todos os números (só dígitos) que o Lardan tem para a pessoa */
  conhecidos?: string[];
  /** o celular do Lardan também está no cadastro de outra pessoa */
  celularCompartilhado?: boolean;
  /** pedido explícito de uma pessoa ("Usar o do Lardan"): manda mesmo nos casos acima */
  forcar?: boolean;
}

export function comparar(lardan: DadosCliente, asaas: (DadosCliente & { notificationDisabled?: boolean | null }) | null, o: OpcoesComparar = {}) {
  const enviar: DadosCliente = {};
  const diferencas: Diferenca[] = [];
  const conhecidos = new Set((o.conhecidos ?? []).map((x) => normalizar("mobilePhone", x)));
  for (const campo of CAMPOS) {
    const l = (lardan[campo] ?? "").trim() || null;
    const a = (asaas?.[campo] ?? "")?.toString().trim() || null;
    if (normalizar(campo, l) === normalizar(campo, a)) continue;
    if (!l || !valido(campo, l)) {
      if (a) diferencas.push({ campo, lardan: l, asaas: a, acao: "so_no_asaas", nota: l ? "O valor do Lardan é inválido; o do Asaas ficou." : "O Lardan não tem; o Asaas ficou como está." });
      continue;
    }
    if (campo === "cpfCnpj" && a) {
      diferencas.push({ campo, lardan: l, asaas: a, acao: "conferir", nota: "CPF diferente: não é trocado sozinho." });
      continue;
    }
    if (!o.forcar) {
      if (campo === "mobilePhone" && o.celularCompartilhado) {
        diferencas.push({ campo, lardan: l, asaas: a, acao: "conferir", nota: "Este celular também está no cadastro de outra pessoa no Lardan." });
        continue;
      }
      if (o.primeira && a && (campo === "mobilePhone" || campo === "phone") && !conhecidos.has(normalizar(campo, a))) {
        diferencas.push({ campo, lardan: l, asaas: a, acao: "conferir", nota: "O Asaas tem um número que o Lardan não conhece: confira com a cliente." });
        continue;
      }
      if (o.primeira && a && campo === "email") {
        diferencas.push({ campo, lardan: l, asaas: a, acao: "conferir", nota: "O Asaas tem outro e-mail: confira com a cliente." });
        continue;
      }
      if (o.primeira && a && campo === "name" && semelhanca(normalizar("name", l), normalizar("name", a)) < 0.85) {
        diferencas.push({ campo, lardan: l, asaas: a, acao: "conferir", nota: "Nome bem diferente no Asaas: confira se é a mesma pessoa." });
        continue;
      }
    }
    enviar[campo] = paraEnvio(campo, l);
    diferencas.push({ campo, lardan: l, asaas: a, acao: "enviar" });
  }
  // endereço vai sempre junto: o Asaas completa rua/bairro pelo CEP e trocaria o resto sozinho
  const ENDERECO: Campo[] = ["postalCode", "address", "addressNumber", "complement", "province"];
  if (ENDERECO.some((k) => k in enviar)) {
    for (const k of ENDERECO) {
      const l = (lardan[k] ?? "").trim();
      if (!(k in enviar) && l && valido(k, l)) enviar[k] = paraEnvio(k, l);
    }
  }
  if (asaas?.notificationDisabled === true) {
    diferencas.push({ campo: "avisos", lardan: null, asaas: "desligados", acao: "conferir", nota: "Os avisos desta cliente estão desligados no Asaas." });
  }
  return { enviar, diferencas };
}

/** Texto curto para a tela. */
export function resumoEspelho(estado: string | null | undefined, difs: Diferenca[]): { texto: string; tom: "ok" | "aviso" | "espera" | "erro" } {
  const pend = difs.filter((d) => d.acao !== "enviar");
  switch (estado) {
    case "igual": case "atualizado":
      return pend.length ? { texto: `Asaas igual ao Lardan, com ${pend.length} ponto(s) para conferir`, tom: "aviso" } : { texto: "Asaas igual ao Lardan", tom: "ok" };
    case "diferente": return { texto: `${pend.length || difs.length} diferença(s) para conferir`, tom: "aviso" };
    case "pendente": case "processando": return { texto: "Atualizando no Asaas…", tom: "espera" };
    case "excluido_no_asaas": return { texto: "Cliente excluída no Asaas", tom: "erro" };
    case "erro": return { texto: "O Asaas não respondeu; vai tentar de novo", tom: "erro" };
    default: return { texto: "Ainda não conferido", tom: "espera" };
  }
}
