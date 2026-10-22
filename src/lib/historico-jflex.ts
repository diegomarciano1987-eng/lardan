/**
 * Histórico do SmallData (migração 0112): importação pelo Master e leituras para
 * ficha da consultora, cockpit de remessas, inteligência de rede, app da
 * consultora e sugestão de montagem. Tudo só leitura sobre a operação.
 */
import { supabase } from "@/integrations/supabase/client";
import { conferirColunas, emBlocos, lerCsv, type LinhaCsv, type TipoHistorico } from "@/lib/historico-jflex-csv";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

export interface ResumoHistorico {
  maletas: number;
  maletas_fechadas: number;
  remessas: number;
  primeira_maleta: string | null;
  ultima_maleta: string | null;
  pecas_enviadas: number;
  pecas_vendidas: number;
  giro_pct: number | null;
  valor_vendido_cents: number;
  ticket_medio_maleta_cents: number | null;
  pecas_defeito: number;
  maletas_perdidas: number;
}
export interface CategoriaHistorico {
  categoria: string;
  pecas_enviadas: number;
  pecas_vendidas: number;
  giro_pct: number | null;
  giro_praca_pct: number | null;
  participacao_vendas_pct: number | null;
  valor_vendido_cents: number;
}
export interface ProdutoTop {
  produto: number;
  nome: string | null;
  referencia: string | null;
  categoria: string | null;
  subcategoria: string | null;
  product_id: string | null;
  quantidade: number;
  valor_cents: number;
  ultima_venda: string | null;
}
export interface MaletaHistorico {
  remessa: number;
  kit: number;
  tipo: "remessa" | "perdida";
  emissao: string | null;
  fechamento: string | null;
  status_remessa: "aberta" | "fechada" | null;
  praca: string | null;
  representante?: string | null;
  pecas_enviadas: number;
  pecas_devolvidas: number;
  /** null enquanto a maleta não tem acerto: venda ainda desconhecida */
  pecas_vendidas: number | null;
  pecas_defeito: number;
  valor_enviado_cents: number;
  valor_vendido_cents: number | null;
  giro_pct: number | null;
  nf_remessa: string | null;
  nf_devolucao: string | null;
  nf_venda: string | null;
  nf_perda: string | null;
}
export interface HistoricoConsultora {
  vinculada: boolean;
  codigos?: number[];
  praca?: { codigo: number; nome: string | null } | null;
  resumo?: ResumoHistorico;
  categorias?: CategoriaHistorico[];
  produtos_top?: ProdutoTop[];
  subcategorias_top?: { categoria: string; subcategoria: string; quantidade: number }[];
  por_ano?: { ano: number; maletas: number; pecas_vendidas: number; valor_vendido_cents: number }[];
  maletas?: MaletaHistorico[];
}
export interface RemessaHistorico {
  numero: number;
  emissao: string | null;
  vencimento: string | null;
  status: "aberta" | "fechada";
  praca_codigo: number | null;
  praca: string | null;
  praca_id: string | null;
  representante_codigo: number | null;
  representante: string | null;
  representante_party_id: string | null;
  maletas: number;
  consultoras: number;
  pecas_enviadas: number;
  pecas_vendidas: number;
  giro_pct: number | null;
  valor_enviado_cents: number;
  valor_vendido_cents: number;
  maletas_sem_acerto: number;
}
export interface LinhaRanking {
  chave: string;
  nome: string | null;
  party_id: string | null;
  maletas: number;
  consultoras: number;
  pecas_enviadas: number;
  pecas_vendidas: number;
  giro_pct: number | null;
  valor_vendido_cents: number;
  ticket_medio_maleta_cents: number | null;
  ultima_maleta: string | null;
}
export interface MesRede {
  mes: string;
  maletas: number;
  consultoras: number;
  pecas_enviadas: number;
  pecas_vendidas: number | null;
  valor_vendido_cents: number | null;
  giro_pct: number | null;
}
export interface SugestaoMontagem {
  total_pecas: number;
  confianca: "alta" | "media" | "baixa";
  pecas_vendidas_historico: number;
  referencia: "praca" | "rede";
  praca_codigo: number | null;
  praca_nome: string | null;
  como_ler: string;
  categorias: {
    categoria: string;
    pecas_sugeridas: number;
    participacao_sugerida_pct: number;
    consultora_pecas_vendidas: number;
    consultora_pecas_enviadas: number;
    consultora_giro_pct: number | null;
    consultora_participacao_vendas_pct: number | null;
    referencia_giro_pct: number | null;
    referencia_participacao_vendas_pct: number;
  }[];
}
export type AgrupamentoRede = "praca" | "representante" | "cidade" | "uf" | "consultora" | "categoria";

// ---------------------------------------------------------------- leituras ---
export const historicoConsultora = (party: string) => rpc<HistoricoConsultora>("legado_consultora_historico", { _party: party });
export const meuHistorico = () => rpc<HistoricoConsultora>("consultora_meu_historico");
export const remessasHistorico = (f: { busca?: string; praca?: number | null; representante?: number | null; de?: string | null; ate?: string | null; status?: "aberta" | "fechada" | null; limite?: number; offset?: number } = {}) =>
  rpc<{ total: number; itens: RemessaHistorico[] }>("legado_remessas_lista", {
    _busca: f.busca?.trim() || null, _praca: f.praca ?? null, _representante: f.representante ?? null,
    _de: f.de ?? null, _ate: f.ate ?? null, _status: f.status ?? null, _limite: f.limite ?? 100, _offset: f.offset ?? 0,
  });
export const remessaHistorico = (numero: number) => rpc<Record<string, unknown> | null>("legado_remessa_detalhe", { _numero: numero });
export const rankingRede = (agrupar: AgrupamentoRede, f: { de?: string | null; ate?: string | null; praca?: number | null; categoria?: string | null; limite?: number } = {}) =>
  rpc<LinhaRanking[]>("legado_rede_ranking", {
    _agrupar: agrupar, _de: f.de ?? null, _ate: f.ate ?? null, _praca: f.praca ?? null, _categoria: f.categoria ?? null, _limite: f.limite ?? 50,
  });
export const redeMensal = (f: { de?: string | null; ate?: string | null; praca?: number | null; representante?: number | null } = {}) =>
  rpc<MesRede[]>("legado_rede_mensal", { _de: f.de ?? null, _ate: f.ate ?? null, _praca: f.praca ?? null, _representante: f.representante ?? null });
export const sugestaoMontagem = (party: string, total: number) => rpc<SugestaoMontagem>("montagem_sugestao", { _party: party, _total: total });
export const resumoHistorico = () => rpc<Record<string, unknown>>("legado_resumo");

// ------------------------------------------- montagem por leitor (0113) ---
export type TipoMeta = "brinco" | "anel" | "colar" | "pulseira" | "tornozeleira" | "outro";
export interface MetasMontagem {
  party_id: string | null;
  vinculada: boolean;
  /** "historico" quando há 10+ peças vendidas no SmallData; senão "padrao" (remessa_parametros) */
  modo_sugerido: "historico" | "padrao";
  confianca: "alta" | "media" | "baixa";
  pecas_vendidas_historico?: number;
  maletas_fechadas?: number;
  referencia?: "praca" | "rede";
  praca_nome?: string | null;
  total_pecas: number;
  /** historico = média das 3 últimas maletas dela; informado = o montador mudou; parametro = padrão */
  total_origem: "historico" | "informado" | "parametro";
  metas_padrao: Record<TipoMeta, number>;
  metas_historico: Record<TipoMeta, number> | null;
  categorias: (SugestaoMontagem["categorias"][number] & { tipo: TipoMeta })[];
  /** giro geral dela e da referência (praça ou rede), maletas fechadas */
  giro_geral_pct?: number | null;
  referencia_giro_geral_pct?: number | null;
  /** onde o mix dela foge da praça: índice = (giro da categoria ÷ giro geral dela) ÷ (o mesmo na praça) */
  destaques: { categoria: string; tipo: TipoMeta; sinal: "forte" | "fraco"; indice: number; giro_pct: number; referencia_giro_pct: number }[];
  /** últimas 3 remessas dela, somando as maletas de cada remessa */
  ultimas_maletas: { remessa: number; fechamento: string; maletas: number; pecas_enviadas: number; pecas_vendidas: number; giro_pct: number | null; valor_vendido_cents: number }[];
  /** variantes dos 10 produtos que ela mais vendeu: a tela marca "campeã dela" ao bipar */
  variantes_campeas: string[];
  como_ler: string;
}
/** Metas da maleta aberta no leitor. total = null usa a média das últimas maletas dela. Só leitura. */
export const metasMontagem = (cycleId: string, total: number | null = null) =>
  rpc<MetasMontagem>("montagem_metas_ciclo", { _cycle: cycleId, _total: total });
export const categoriaTipoLista = () => rpc<{ categoria: string; tipo: TipoMeta; mapeada: boolean }[]>("legado_categoria_tipo_lista");
export const categoriaTipoDefinir = (categoria: string, tipo: TipoMeta) =>
  rpc("legado_categoria_tipo_definir", { _categoria: categoria, _tipo: tipo });
export const roteiroFiscalObservado = () => rpc<Record<string, unknown>[]>("fiscal_roteiro_observado");

// ------------------------------------------------------- importação (Master) ---
export interface ProgressoImportacao {
  tipo: TipoHistorico;
  enviadas: number;
  total: number;
}

/** Envia um arquivo em blocos de 1.000 linhas; reenviar é seguro (o banco atualiza, não duplica). */
export async function importarArquivoHistorico(tipo: TipoHistorico, texto: string, lote: string,
  aoAvancar?: (p: ProgressoImportacao) => void): Promise<number> {
  const linhas: LinhaCsv[] = lerCsv(texto);
  const erro = conferirColunas(tipo, linhas);
  if (erro) throw new Error(erro);
  let enviadas = 0;
  for (const bloco of emBlocos(linhas, 1000)) {
    let tentativa = 0;
    for (;;) {
      try {
        await rpc("legado_importar", { _tipo: tipo, _lote: lote, _linhas: bloco });
        break;
      } catch (e) {
        tentativa += 1;
        if (tentativa >= 3) throw e;
        await new Promise((r) => setTimeout(r, 1500 * tentativa));
      }
    }
    enviadas += bloco.length;
    aoAvancar?.({ tipo, enviadas, total: linhas.length });
  }
  return linhas.length;
}

export const vincularHistorico = (gravarCodigos = true) =>
  rpc<{ consultoras: Record<string, number>; representantes: Record<string, number>; pracas: Record<string, number>; produtos: Record<string, number> }>(
    "legado_vincular", { _gravar_codigos: gravarCodigos });
export const pendenciasVinculo = (busca = "", limite = 100) =>
  rpc<{ codcli: number; nome: string | null; cidade: string | null; uf: string | null; ativo: boolean; cpf_mascarado: string | null; maletas: number; ultima_maleta: string | null; pessoas_com_mesmo_cpf: number }[]>(
    "legado_pendencias_vinculo", { _busca: busca || null, _limite: limite });
export const vincularConsultoraManual = (codcli: number, party: string | null) =>
  rpc("legado_consultora_vincular", { _codcli: codcli, _party: party });
