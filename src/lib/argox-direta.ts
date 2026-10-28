import { assinarQz } from "@/lib/qz.functions";
import type { LinguagemArgox } from "@/lib/etiquetas-raw";

/**
 * Impressão direta na Argox pelo programa QZ Tray instalado no computador.
 * Envia os comandos da própria impressora: sem tela do navegador e sem papel do Windows.
 * Nome da impressora e linguagem ficam neste computador (cada estação tem a sua Argox).
 */
const ESTACAO_KEY = "lardan.argox.estacao.v1";
export type EstacaoArgox = { impressora: string | null; linguagem: LinguagemArgox };
export const QZ_DOWNLOAD = "https://qz.io/download/";

export function lerEstacao(): EstacaoArgox {
  try {
    const v = JSON.parse(localStorage.getItem(ESTACAO_KEY) ?? "null") as Partial<EstacaoArgox> | null;
    return { impressora: v?.impressora ?? null, linguagem: v?.linguagem === "pplz" || v?.linguagem === "ppla" ? v.linguagem : (/ppla/i.test(v?.impressora ?? "") ? "ppla" : "pplb") };
  } catch { return { impressora: null, linguagem: "pplb" }; }
}
export function salvarEstacao(e: EstacaoArgox) { localStorage.setItem(ESTACAO_KEY, JSON.stringify(e)); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Qz = any;
let qzPronto: Promise<Qz> | null = null;

async function conectar(): Promise<Qz> {
  if (!qzPronto) qzPronto = (async () => {
    const mod = await import("qz-tray");
    const qz: Qz = (mod as { default?: Qz }).default ?? mod;
    qz.api.setPromiseType((r: (res: (v: unknown) => void, rej: (e: unknown) => void) => void) => new Promise(r));
    qz.security.setCertificatePromise((res: (v: string) => void, rej: (e: unknown) => void) => {
      fetch("/qz/lardan-qz.crt", { cache: "no-store" }).then((r) => r.ok ? r.text() : Promise.reject(new Error("Certificado ausente."))).then(res, rej);
    });
    qz.security.setSignatureAlgorithm("SHA512");
    qz.security.setSignaturePromise((texto: string) => (res: (v: string) => void, rej: (e: unknown) => void) => {
      assinarQz({ data: { texto } }).then((r) => res(r.assinatura), rej);
    });
    if (!qz.websocket.isActive()) {
      try { await qz.websocket.connect({ retries: 1, delay: 1 }); }
      catch { throw new Error("O programa de impressão direta (QZ Tray) não está aberto neste computador. Abra ou instale em Remessas → Configurar impressora → Calibrar Argox."); }
    }
    return qz;
  })().catch((e) => { qzPronto = null; throw e; });
  return qzPronto;
}

export async function listarImpressoras(): Promise<string[]> {
  const qz = await conectar();
  const l = await qz.printers.find();
  return Array.isArray(l) ? l : [l];
}

async function escolherImpressora(est: EstacaoArgox): Promise<string> {
  // Impressora já escolhida neste computador: imprime direto, sem pedir a lista ao QZ (cada pedido gera uma autorização).
  if (est.impressora) return est.impressora;
  const lista = await listarImpressoras();
  const argox = lista.filter((n) => /argox/i.test(n));
  if (argox.length === 1) { salvarEstacao({ ...est, impressora: argox[0]! }); return argox[0]!; }
  throw new Error(argox.length ? "Há mais de uma Argox neste computador. Escolha qual em Calibrar Argox." : "Nenhuma Argox encontrada neste computador. Escolha a impressora em Calibrar Argox.");
}

export async function imprimirDireto(comandos: string, est: EstacaoArgox = lerEstacao()) {
  const qz = await conectar();
  const impressora = await escolherImpressora(est);
  const cfg = qz.configs.create(impressora, { encoding: "ISO-8859-1" });
  await qz.print(cfg, [{ type: "raw", format: "command", flavor: "plain", data: comandos }]);
  return impressora;
}
