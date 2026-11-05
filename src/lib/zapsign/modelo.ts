/**
 * Preenche os modelos de assinatura digital (contrato e promissória).
 * Puro: sem rede, sem banco. Campos {{nome}} viram o valor; o que faltar sai
 * como linha em branco para não mandar documento com "{{campo}}" à consultora.
 */
import { valorPorExtenso } from "@/lib/remessa";

export interface CamposAssinatura {
  nome: string; cpf: string; codigo?: string | null; endereco: string; bairro: string; cidade: string; cep: string; whatsapp: string;
  representante: string; praca: string; maleta: string; remessa: string;
  valor_cents?: number | null; vencimento?: string | null;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export function dataExtenso(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(`${iso.slice(0, 10)}T12:00:00-03:00`) : iso;
  const sp = new Date(d.getTime() - 3 * 3600_000);
  return `${sp.getUTCDate()} de ${MESES[sp.getUTCMonth()]} de ${sp.getUTCFullYear()}`;
}
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const BRANCO = "________________";

export function valoresDosCampos(c: CamposAssinatura, hoje = new Date()): Record<string, string> {
  const v: Record<string, string> = {
    nome: c.nome, cpf: c.cpf, codigo: c.codigo ?? "", endereco: c.endereco, bairro: c.bairro, cidade: c.cidade, cep: c.cep,
    whatsapp: c.whatsapp, representante: c.representante, praca: c.praca, maleta: c.maleta, remessa: c.remessa,
    hoje: dataBr(new Date(hoje.getTime() - 3 * 3600_000).toISOString()), hoje_extenso: dataExtenso(hoje),
  };
  if (c.valor_cents != null) { v["valor"] = brl(c.valor_cents); v["valor_extenso"] = valorPorExtenso(c.valor_cents); }
  if (c.vencimento) { v["vencimento"] = dataBr(c.vencimento); v["vencimento_extenso"] = dataExtenso(c.vencimento); }
  return v;
}

/** Troca {{campo}} pelo valor (escapando markdown); campo vazio ou desconhecido vira linha em branco. */
export function preencherModelo(texto: string, valores: Record<string, string>): string {
  return texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, k: string) => {
    const v = (valores[k] ?? "").trim();
    return v ? v.replace(/([*_`#>\[\]\\])/g, "\\$1") : BRANCO;
  });
}

/** Telefone para a ZapSign: país separado, DDD + número. */
export function telefoneZapsign(digitos: string | null | undefined): { phone_country: string; phone_number: string } | null {
  let d = (digitos ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return { phone_country: "55", phone_number: d };
}
