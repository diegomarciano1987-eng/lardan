/**
 * Monta o JSON de NF-e da Focus a partir do roteiro fiscal da Lardan.
 * Puro (sem rede, sem banco): o servidor usa para emitir e os testes conferem.
 *
 * Roteiro conferido nas notas que o SmallData emitiu (série 2, 2023–2026):
 *   remessa   saída   5917 / 6917  "- REM/CONSIG."
 *   devolução ENTRADA 1918 / 2918  "- DEVOLUCAO REMESSA"  finalidade 4, referencia a NF de remessa
 *   venda     saída   5114 / 6114  "- VENDA CONSIGNADO"    simples faturamento
 *   perda     saída   5927 / 6949  "- PERDA DE PRODUTOS"
 * Em todas: CSOSN 102, PIS/COFINS 07, origem 0, NCM 71171900 (padrão), unidade UND,
 * consumidor final 1, presença 1, frete 9, destinatária não contribuinte (9),
 * valor da peça = 1/3 do preço de varejo.
 */
export type OperacaoNfe = "remessa" | "devolucao" | "venda" | "perda";
export type AmbienteNfe = "homologacao" | "producao";

export const ROTEIRO: Record<OperacaoNfe, { natureza: string; cfopInterno: string; cfopFora: string; tipoDocumento: 0 | 1; finalidade: 1 | 4; referenciaObrigatoria: boolean }> = {
  remessa: { natureza: "- REM/CONSIG.", cfopInterno: "5917", cfopFora: "6917", tipoDocumento: 1, finalidade: 1, referenciaObrigatoria: false },
  devolucao: { natureza: "- DEVOLUCAO REMESSA", cfopInterno: "1918", cfopFora: "2918", tipoDocumento: 0, finalidade: 4, referenciaObrigatoria: true },
  venda: { natureza: "- VENDA CONSIGNADO", cfopInterno: "5114", cfopFora: "6114", tipoDocumento: 1, finalidade: 1, referenciaObrigatoria: false },
  perda: { natureza: "- PERDA DE PRODUTOS", cfopInterno: "5927", cfopFora: "6949", tipoDocumento: 1, finalidade: 1, referenciaObrigatoria: false },
};

/** Nome que a SEFAZ exige para a destinatária em homologação (rejeição 598 se for outro). */
export const NOME_HOMOLOGACAO = "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

export interface DestinatarioNfe {
  nome: string;
  cpf: string;
  logradouro: string | null;
  numero: string | null;
  complemento?: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
  codigo_municipio: string | null;
  email?: string | null;
  telefone?: string | null;
}
export interface ItemNfe {
  codigo: string;
  descricao: string;
  ncm: string;
  quantidade: number;
  preco_varejo_cents: number;
}
export interface OrigemNfe {
  /** chave de 44 dígitos da NF de remessa (devolução, venda, perda) */
  chave: string;
  numero: string | number;
  /** data de emissão da remessa (AAAA-MM-DD) */
  data: string;
}
export interface EntradaNfe {
  operacao: OperacaoNfe;
  ambiente: AmbienteNfe;
  cnpjEmitente: string;
  ufEmitente: string;
  destinatario: DestinatarioNfe;
  itens: ItemNfe[];
  /** número da remessa e do kit (texto complementar "----- REMESSA: n KIT: k -----") */
  remessa?: { numero: number | string; kit: number | string } | null;
  origem?: OrigemNfe | null;
  /** ISO com fuso; padrão: agora em São Paulo */
  dataEmissao?: string;
}

const so = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const ate = (s: string | null | undefined, n: number) => (s ?? "").trim().slice(0, n);
/** 1/3 do varejo, em reais com 2 casas (arredondamento por item, como o SmallData fazia). */
export const valorFiscalUnitario = (precoVarejoCents: number) => Math.round(precoVarejoCents / 3) / 100;
const dinheiro = (v: number) => Math.round(v * 100) / 100;
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

export function agoraSaoPaulo(d = new Date()): string {
  // São Paulo sem horário de verão desde 2019: UTC-03:00
  const local = new Date(d.getTime() - 3 * 3600_000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

/** Confere o que impediria a SEFAZ de autorizar. Lista vazia = pode enviar. */
export function pendenciasNfe(e: EntradaNfe): string[] {
  const p: string[] = [];
  const d = e.destinatario;
  if (so(e.cnpjEmitente).length !== 14) p.push("CNPJ do emissor inválido");
  if (!/^[A-Z]{2}$/.test(e.ufEmitente ?? "")) p.push("UF do emissor ausente");
  if (so(d.cpf).length !== 11) p.push("CPF da consultora inválido");
  if (!d.logradouro?.trim()) p.push("endereço sem rua");
  if (!d.bairro?.trim()) p.push("endereço sem bairro");
  if (!/^\d{7}$/.test(so(d.codigo_municipio))) p.push("cidade sem código IBGE");
  if (!/^\d{8}$/.test(so(d.cep))) p.push("CEP inválido");
  if (!/^[A-Z]{2}$/.test((d.uf ?? "").toUpperCase())) p.push("UF da consultora ausente");
  if (e.itens.length === 0) p.push("sem peças");
  if (e.itens.some((i) => !(i.quantidade > 0) || !Number.isInteger(i.quantidade))) p.push("quantidade inválida");
  if (e.itens.some((i) => !(i.preco_varejo_cents > 0))) p.push("peça sem preço de varejo");
  if (e.itens.some((i) => !/^\d{8}$/.test(so(i.ncm)))) p.push("peça com NCM inválido");
  const r = ROTEIRO[e.operacao];
  if (e.operacao !== "remessa") {
    if (!e.origem || !/^\d{44}$/.test(so(e.origem.chave))) p.push("falta a NF de remessa de origem");
  }
  if (r.referenciaObrigatoria && !e.origem) p.push("devolução precisa referenciar a remessa");
  return p;
}

function textoComplementar(e: EntradaNfe): string {
  const partes: string[] = [];
  if (e.remessa) partes.push(`----- REMESSA: ${e.remessa.numero} KIT: ${e.remessa.kit} -----`);
  const o = e.origem;
  if (e.operacao === "devolucao" && o)
    partes.push(`DEVOLUCAO DAS MERCADORIAS RECEBIDAS EM CONSIGNACAO MERCANTIL ATRAVES DA NF N. ${o.numero}, DE ${dataBr(o.data)}`);
  if (e.operacao === "venda" && o) partes.push(`SIMPLES FATURAMENTO DE MERCADORIA EM CONSIGNACAO - NF N. ${o.numero}, DE ${dataBr(o.data)}`);
  if (e.operacao === "perda") partes.push("NOTA REFERENTE A PERDA DE MERCADORIA EM CONSIGNACAO");
  return partes.join(";");
}

/** JSON para POST /v2/nfe?ref=... da Focus. Lança erro se houver pendência. */
export function montarNfe(e: EntradaNfe): Record<string, unknown> {
  const pend = pendenciasNfe(e);
  if (pend.length) throw new Error(`Nota não pode ser enviada: ${pend.join("; ")}.`);
  const r = ROTEIRO[e.operacao];
  const d = e.destinatario;
  const ufDest = (d.uf ?? "").toUpperCase();
  const interna = ufDest === e.ufEmitente.toUpperCase();
  const cfop = interna ? r.cfopInterno : r.cfopFora;

  const items = e.itens.map((i, n) => {
    const unit = valorFiscalUnitario(i.preco_varejo_cents);
    const bruto = dinheiro(unit * i.quantidade);
    return {
      numero_item: n + 1,
      codigo_produto: ate(i.codigo, 60),
      descricao: ate(i.descricao, 120),
      cfop,
      codigo_ncm: so(i.ncm),
      unidade_comercial: "UND",
      quantidade_comercial: i.quantidade,
      valor_unitario_comercial: unit,
      valor_bruto: bruto,
      unidade_tributavel: "UND",
      quantidade_tributavel: i.quantidade,
      valor_unitario_tributavel: unit,
      inclui_no_total: 1,
      icms_origem: 0,
      icms_situacao_tributaria: "102",
      pis_situacao_tributaria: "07",
      cofins_situacao_tributaria: "07",
    };
  });
  const total = dinheiro(items.reduce((s, i) => s + i.valor_bruto, 0));
  const emissao = e.dataEmissao ?? agoraSaoPaulo();
  const texto = textoComplementar(e);

  const nfe: Record<string, unknown> = {
    natureza_operacao: r.natureza,
    data_emissao: emissao,
    data_entrada_saida: emissao,
    tipo_documento: r.tipoDocumento,
    finalidade_emissao: r.finalidade,
    local_destino: interna ? 1 : 2,
    consumidor_final: 1,
    presenca_comprador: 1,
    modalidade_frete: 9,
    regime_tributario_emitente: 1,
    cnpj_emitente: so(e.cnpjEmitente),
    nome_destinatario: e.ambiente === "homologacao" ? NOME_HOMOLOGACAO : ate(d.nome, 60),
    cpf_destinatario: so(d.cpf),
    indicador_inscricao_estadual_destinatario: 9,
    logradouro_destinatario: ate(d.logradouro, 60),
    numero_destinatario: ate(d.numero || "S/N", 60),
    bairro_destinatario: ate(d.bairro, 60),
    municipio_destinatario: ate(d.municipio, 60),
    codigo_municipio_destinatario: so(d.codigo_municipio),
    uf_destinatario: ufDest,
    cep_destinatario: so(d.cep),
    pais_destinatario: "Brasil",
    valor_produtos: total,
    valor_total: total,
    items,
  };
  if (d.complemento?.trim()) nfe["complemento_destinatario"] = ate(d.complemento, 60);
  if (d.telefone && so(d.telefone).length >= 10) nfe["telefone_destinatario"] = so(d.telefone);
  if (d.email?.includes("@")) nfe["email_destinatario"] = d.email.trim();
  if (texto) nfe["informacoes_adicionais_contribuinte"] = texto;
  if (r.referenciaObrigatoria && e.origem) nfe["notas_referenciadas"] = [{ chave_nfe: so(e.origem.chave) }];
  return nfe;
}

/** Referência única aceita pela Focus e pelo banco: letras, números, _ e -. */
export function novaReferencia(prefixo: string, operacao: OperacaoNfe): string {
  const aleatorio = Math.random().toString(36).slice(2, 10);
  return `${prefixo}-${operacao}-${Date.now().toString(36)}-${aleatorio}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
}
