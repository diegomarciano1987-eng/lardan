import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Linha já interpretada do extrato, pronta para ser gravada pelo servidor. */
export type LinhaExtrato = {
  line_no: number;
  data: string;
  valor_cents: number | null;
  kind: "entrada" | "saida" | "";
  historico: string;
  documento: string;
  bank_id: string;
  raw: Record<string, string>;
  raw_text: string;
  error_reason: string;
};

const semAcento = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** Converte texto monetário em centavos usando apenas inteiros (nunca ponto flutuante). */
export function textoParaCentavos(bruto: string): number | null {
  const t = (bruto ?? "").trim();
  if (!t) return null;
  const negativo = /^-/.test(t) || /\(.*\)/.test(t) || /\bD$/i.test(t.replace(/\s/g, ""));
  const limpo = t.replace(/[^0-9.,]/g, "");
  if (!limpo) return null;
  let inteiro = limpo;
  let frac = "";
  const temVirgula = limpo.includes(",");
  const temPonto = limpo.includes(".");
  if (temVirgula) {
    const partes = limpo.split(",");
    frac = partes.pop() ?? "";
    inteiro = partes.join("").replace(/\./g, "");
  } else if (temPonto) {
    const partes = limpo.split(".");
    const ultima = partes[partes.length - 1] ?? "";
    if (partes.length > 1 && ultima.length <= 2) {
      frac = ultima;
      inteiro = partes.slice(0, -1).join("");
    } else {
      inteiro = partes.join("");
    }
  }
  if (frac.length > 2) frac = frac.slice(0, 2);
  const digitosInteiro = inteiro.replace(/\D/g, "") || "0";
  const digitosFrac = (frac.replace(/\D/g, "") + "00").slice(0, 2);
  const cents = Number(digitosInteiro) * 100 + Number(digitosFrac);
  if (!Number.isFinite(cents)) return null;
  return negativo ? -cents : cents;
}

/** Datas ambíguas são recusadas: exigimos formato declarado (dd/mm/aaaa ou aaaa-mm-dd). */
export function textoParaData(bruto: string): string | null {
  const t = (bruto ?? "").trim();
  if (!t) return null;
  const valida = (a: number, mes: number, d: number): string | null => {
    if (mes < 1 || mes > 12 || d < 1) return null;
    const ultimo = new Date(Date.UTC(a, mes, 0)).getUTCDate();
    if (d > ultimo) return null; // 31/02, 31/04 etc.
    return `${String(a).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return valida(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return valida(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{8})$/.exec(t);
  if (m) return valida(Number(t.slice(0, 4)), Number(t.slice(4, 6)), Number(t.slice(6, 8)));
  return null;
}

const COLUNAS: Record<string, string[]> = {
  data: ["data", "data lancamento", "data do lancamento", "date", "dt", "data mov"],
  valor: ["valor", "value", "amount", "vlr", "valor r$", "montante"],
  credito: ["credito", "entrada", "credit"],
  debito: ["debito", "saida", "debit"],
  historico: ["historico", "descricao", "description", "memo", "lancamento", "detalhe"],
  documento: ["documento", "doc", "numero documento", "nro documento", "num doc", "checknum"],
  bank_id: ["id", "identificador", "fitid", "id transacao", "codigo"],
};

function acharColuna(cabecalho: string[], alvo: string): number {
  const nomes = COLUNAS[alvo] ?? [];
  return cabecalho.findIndex((c) => nomes.includes(semAcento(c)));
}

function dividirCSV(linha: string, sep: string): string[] {
  const saida: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const ch = linha[i];
    if (ch === '"') {
      if (aspas && linha[i + 1] === '"') {
        atual += '"';
        i += 1;
      } else aspas = !aspas;
    } else if (ch === sep && !aspas) {
      saida.push(atual);
      atual = "";
    } else atual += ch;
  }
  saida.push(atual);
  // preserva zeros à esquerda: nunca convertemos para número
  return saida.map((c) => c.trim().replace(/^\uFEFF/, ""));
}

export function interpretarCSV(conteudo: string): LinhaExtrato[] {
  const linhas = conteudo
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (linhas.length === 0) return [];
  const primeira = linhas[0] ?? "";
  const sep = (primeira.match(/;/g) ?? []).length >= (primeira.match(/,/g) ?? []).length ? ";" : ",";
  const cabecalho = dividirCSV(primeira, sep);
  const idx = {
    data: acharColuna(cabecalho, "data"),
    valor: acharColuna(cabecalho, "valor"),
    credito: acharColuna(cabecalho, "credito"),
    debito: acharColuna(cabecalho, "debito"),
    historico: acharColuna(cabecalho, "historico"),
    documento: acharColuna(cabecalho, "documento"),
    bank_id: acharColuna(cabecalho, "bank_id"),
  };
  const saida: LinhaExtrato[] = [];
  for (let i = 1; i < linhas.length; i += 1) {
    const bruta = linhas[i] ?? "";
    const cols = dividirCSV(bruta, sep);
    const pegar = (p: number) => (p >= 0 ? (cols[p] ?? "") : "");
    const data = textoParaData(pegar(idx.data));
    let cents: number | null = null;
    if (idx.valor >= 0) cents = textoParaCentavos(pegar(idx.valor));
    if (cents === null && idx.credito >= 0) {
      const c = textoParaCentavos(pegar(idx.credito));
      if (c) cents = Math.abs(c);
    }
    if (cents === null && idx.debito >= 0) {
      const d = textoParaCentavos(pegar(idx.debito));
      if (d) cents = -Math.abs(d);
    }
    const raw: Record<string, string> = {};
    cabecalho.forEach((c, p) => {
      raw[c || `coluna_${p + 1}`] = cols[p] ?? "";
    });
    let erro = "";
    if (idx.data < 0) erro = "Arquivo sem coluna de data reconhecida";
    else if (data === null) erro = "Data ausente ou ambígua";
    else if (cents === null || cents === 0) erro = "Valor inválido";
    saida.push({
      line_no: i + 1,
      data: data ?? "",
      valor_cents: cents === null ? null : Math.abs(cents),
      kind: cents === null ? "" : cents < 0 ? "saida" : "entrada",
      historico: pegar(idx.historico),
      documento: pegar(idx.documento),
      bank_id: pegar(idx.bank_id),
      raw,
      raw_text: bruta,
      error_reason: erro,
    });
  }
  return saida;
}

export function interpretarOFX(conteudo: string): LinhaExtrato[] {
  const blocos = conteudo.split(/<STMTTRN>/i).slice(1);
  const tag = (bloco: string, nome: string) => {
    const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, "i").exec(bloco);
    return (m?.[1] ?? "").trim();
  };
  return blocos.map((bloco, i) => {
    const data = textoParaData(tag(bloco, "DTPOSTED").slice(0, 8));
    const cents = textoParaCentavos(tag(bloco, "TRNAMT"));
    const tipo = tag(bloco, "TRNTYPE").toUpperCase();
    let erro = "";
    if (data === null) erro = "Data ausente ou ambígua";
    else if (cents === null || cents === 0) erro = "Valor inválido";
    const negativo = cents !== null && (cents < 0 || tipo === "DEBIT");
    return {
      line_no: i + 1,
      data: data ?? "",
      valor_cents: cents === null ? null : Math.abs(cents),
      kind: cents === null ? "" : negativo ? ("saida" as const) : ("entrada" as const),
      historico: tag(bloco, "MEMO") || tag(bloco, "NAME"),
      documento: tag(bloco, "CHECKNUM") || tag(bloco, "REFNUM"),
      bank_id: tag(bloco, "FITID"),
      raw: { trntype: tipo, fitid: tag(bloco, "FITID"), trnamt: tag(bloco, "TRNAMT") },
      raw_text: `<STMTTRN>${bloco.slice(0, 500)}`,
      error_reason: erro,
    };
  });
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Lê o arquivo já enviado ao armazenamento privado, calcula a impressão digital no
 * servidor, interpreta CSV ou OFX e grava as linhas originais pela RPC oficial.
 */
export const processarExtrato = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      financial_account_id: string;
      storage_path: string;
      original_name: string;
      format: "csv" | "ofx";
      size_bytes: number;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const baixado = await supabaseAdmin.storage.from("extratos-bancarios").download(data.storage_path);
    if (baixado.error || !baixado.data) throw new Error("Não foi possível ler o arquivo enviado.");
    const buffer = await baixado.data.arrayBuffer();
    const hash = await sha256(buffer);
    const texto = new TextDecoder("utf-8").decode(buffer);

    const reg = await context.supabase.rpc("fin_statement_file_register", {
      _payload: {
        financial_account_id: data.financial_account_id,
        storage_path: data.storage_path,
        original_name: data.original_name,
        format: data.format,
        size_bytes: data.size_bytes,
        sha256: hash,
      },
    });
    if (reg.error) throw new Error(reg.error.message);
    const registro = reg.data as { file_id: string; import_id: string; repetido: boolean; concluido?: boolean };
    // arquivo registrado não é arquivo concluído: só encerra se as linhas já entraram
    if (registro.repetido && registro.concluido !== false) {
      return { ...registro, sha256: hash, total: 0, validas: 0, invalidas: 0, repetidas: 0 };
    }

    const linhas = data.format === "ofx" ? interpretarOFX(texto) : interpretarCSV(texto);
    if (linhas.length === 0) throw new Error("Arquivo sem lançamentos reconhecidos.");

    const stage = await context.supabase.rpc("fin_statement_lines_stage", {
      _import: registro.import_id,
      _lines: linhas,
    });
    if (stage.error) throw new Error(stage.error.message);
    const resumo = stage.data as {
      total: number;
      validas: number;
      invalidas: number;
      repetidas: number;
    };
    return { ...registro, sha256: hash, ...resumo };
  });
