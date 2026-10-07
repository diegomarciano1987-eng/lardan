import { supabase } from "@/integrations/supabase/client";
import { textoParaCentavos, textoParaData } from "@/lib/conciliacao.functions";

async function rpc<T>(f: string, a: Record<string, unknown>): Promise<T> {
  const { data, error } = (await supabase.rpc(f as never, a as never)) as unknown as {
    data: T;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);
  return data;
}

export interface CartaoConfig {
  account_id: string;
  final_cartao: string | null;
  bandeira: string | null;
  dia_fechamento: number | null;
  dia_vencimento: number;
  limite_cents: number | null;
  conta_pagamento_id: string | null;
  conta_pagamento: string | null;
  emissor_party_id: string | null;
  emissor: string | null;
}

export interface FaturaResumo {
  id: string;
  referencia: string;
  vencimento: string;
  status: "aberta" | "fechada";
  title_id: string | null;
  titulo_numero: string | null;
  total_cents: number;
  qtd: number;
  sem_classificacao: number;
  pago_cents: number;
}

export interface LinhaCartao {
  id: string;
  data: string;
  descricao: string;
  valor_cents: number;
  parcela: string | null;
  chart_account_id: string | null;
  chart: string | null;
  cost_center_id: string | null;
  centro: string | null;
  classificado_por: "ia" | "manual" | "historico" | null;
  ia_confianca: number | null;
  ia_motivo: string | null;
}

export interface FaturaDetalhe {
  fatura: FaturaResumo & { cartao: string; account_id: string };
  linhas: LinhaCartao[];
}

export const criarCartao = (p: Record<string, unknown>) => rpc<string>("fin_cartao_criar", { _payload: p });
export const salvarConfigCartao = (account: string, p: Record<string, unknown>) =>
  rpc<void>("fin_cartao_config_set", { _account: account, _payload: p });
export const painelCartao = (account: string) =>
  rpc<{ config: CartaoConfig | null; faturas: FaturaResumo[] }>("fin_cartao_painel", { _account: account });
export const abrirFatura = (account: string, referencia: string, vencimento: string) =>
  rpc<string>("fin_cartao_fatura_abrir", { _account: account, _referencia: referencia, _vencimento: vencimento });
export const importarGastos = (fatura: string, linhas: GastoLido[]) =>
  rpc<{ inseridos: number; repetidos: number }>("fin_cartao_importar", {
    _fatura: fatura,
    _linhas: linhas.map((l) => ({
      data: l.data,
      descricao: l.descricao,
      valor_cents: l.valor_cents,
      parcela: l.parcela,
      ocorrencia: l.ocorrencia,
    })),
  });
export const detalheFatura = (fatura: string) => rpc<FaturaDetalhe>("fin_cartao_fatura_detalhe", { _fatura: fatura });
export const classificarGastos = (
  itens: { id: string; chart_account_id: string | null; cost_center_id: string | null; origem?: string }[],
) => rpc<number>("fin_cartao_classificar", { _itens: itens });
export const excluirGasto = (id: string, motivo: string) =>
  rpc<void>("fin_cartao_lancamento_excluir", { _id: id, _motivo: motivo });
export const fecharFatura = (fatura: string, p: Record<string, unknown>) =>
  rpc<string>("fin_cartao_fechar", { _fatura: fatura, _payload: p });
export const reabrirFatura = (fatura: string, motivo: string) =>
  rpc<void>("fin_cartao_reabrir", { _fatura: fatura, _motivo: motivo });

/* ===================== Leitura do extrato ===================== */

export interface GastoLido {
  data: string;
  descricao: string;
  valor_cents: number;
  parcela: string | null;
  ocorrencia: number;
  incluir: boolean;
  erro?: string;
}

const PAGAMENTO = /pagamento\s*(de\s*)?fatura|pgto\.?\s*fatura|pagamento\s*recebido|pagamento\s*efetuado|^pagamento$/i;

function parcelaDe(desc: string): string | null {
  const m = desc.match(/(?:parc(?:ela)?\.?\s*)?\b(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b\s*$/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a >= 1 && b >= 2 && a <= b && b <= 48 ? `${a}/${b}` : null;
}

function numerar(linhas: Omit<GastoLido, "ocorrencia" | "incluir">[]): GastoLido[] {
  const vistos = new Map<string, number>();
  return linhas.map((l) => {
    const k = `${l.data}|${l.descricao.toLowerCase()}|${l.valor_cents}`;
    const n = (vistos.get(k) ?? 0) + 1;
    vistos.set(k, n);
    return { ...l, ocorrencia: n, incluir: !l.erro && !PAGAMENTO.test(l.descricao) };
  });
}

/** OFX de cartão: compra vem negativa (saída); gravamos gasto como positivo e estorno/crédito como negativo. */
export function lerOfx(texto: string): GastoLido[] {
  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  const tag = (b: string, t: string) => b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, "i"))?.[1]?.trim() ?? "";
  return numerar(
    blocos.map((b) => {
      const dt = tag(b, "DTPOSTED");
      const data = /^\d{8}/.test(dt) ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : "";
      const desc = (tag(b, "MEMO") || tag(b, "NAME")).replace(/\s+/g, " ");
      const v = textoParaCentavos(tag(b, "TRNAMT"));
      return {
        data,
        descricao: desc,
        valor_cents: v === null ? 0 : -v,
        parcela: parcelaDe(desc),
        ...(!data || !desc || !v ? { erro: "Linha incompleta" } : {}),
      };
    }),
  );
}

function dividir(linha: string, sep: string): string[] {
  const out: string[] = [];
  let atual = "";
  let aspas = false;
  for (const ch of linha) {
    if (ch === '"') aspas = !aspas;
    else if (ch === sep && !aspas) {
      out.push(atual.trim());
      atual = "";
    } else atual += ch;
  }
  out.push(atual.trim());
  return out;
}

const norm = (t: string) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/**
 * CSV / texto colado: reconhece cabeçalho (data, descrição/estabelecimento, valor).
 * Sem cabeçalho: 1ª coluna data, 2ª descrição, última valor. Gasto positivo; `inverter` troca o sinal.
 */
export function lerCsv(texto: string, inverter = false): GastoLido[] {
  const linhas = texto.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!linhas.length) return [];
  const primeira = linhas[0] ?? "";
  const sep = ["\t", ";", ","].sort((a, b) => primeira.split(b).length - primeira.split(a).length)[0] ?? ";";
  const cab = dividir(primeira, sep).map(norm);
  let iData = cab.findIndex((c) => /^data|date/.test(c));
  let iDesc = cab.findIndex((c) => /descri|estabelec|lancamento|historico|title|memo/.test(c));
  let iValor = cab.findIndex((c) => /valor|amount|r\$/.test(c));
  let inicio = 1;
  if (iData < 0 || iDesc < 0 || iValor < 0) {
    inicio = textoParaData(dividir(primeira, sep)[0] ?? "") ? 0 : 1;
    iData = 0;
    iDesc = 1;
    iValor = -1;
  }
  return numerar(
    linhas.slice(inicio).map((l) => {
      const c = dividir(l, sep);
      const data = textoParaData(c[iData] ?? "") ?? "";
      const desc = (c[iDesc] ?? "").replace(/\s+/g, " ").trim();
      const bruto = iValor >= 0 ? (c[iValor] ?? "") : (c[c.length - 1] ?? "");
      const v = textoParaCentavos(bruto);
      const valor = v === null ? 0 : inverter ? -v : v;
      return {
        data,
        descricao: desc,
        valor_cents: valor,
        parcela: parcelaDe(desc),
        ...(!data ? { erro: "Data não reconhecida" } : !desc ? { erro: "Sem descrição" } : !v ? { erro: "Valor inválido" } : {}),
      };
    }),
  );
}

export function lerExtrato(nome: string, texto: string, inverter = false): GastoLido[] {
  return /\.ofx$/i.test(nome) || /<OFX>|<STMTTRN>/i.test(texto) ? lerOfx(texto) : lerCsv(texto, inverter);
}

/** Próxima data de vencimento para um dia do mês (ajusta meses curtos). */
export function proximoVencimento(dia: number, base = new Date()): string {
  const make = (y: number, m: number) => {
    const ultimo = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(dia, ultimo));
  };
  let d = make(base.getFullYear(), base.getMonth());
  if (d < new Date(base.getFullYear(), base.getMonth(), base.getDate())) d = make(base.getFullYear(), base.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
