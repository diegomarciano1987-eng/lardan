/**
 * Porta de acesso ao banco usada pelos serviços do Asaas.
 *
 * Existe para que o MESMO serviço rode contra o banco da aplicação e contra o
 * banco isolado dos testes. Os testes não reescrevem a importação: eles trocam
 * apenas esta porta e o transporte.
 */
export interface BancoAsaas {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
}

export const ROTINAS = {
  importarAbrir: "asaas_import_abrir",
  importarPagina: "asaas_import_pagina",
  importarPrevia: "asaas_import_previa",
  importarResolver: "asaas_import_resolver",
  importarAprovar: "asaas_import_aprovar",
  importarEfetivar: "asaas_import_efetivar",
  cobrancaPreparar: "asaas_cobranca_preparar",
  cobrancaProcessando: "asaas_cobranca_processando",
  cobrancaResultado: "asaas_cobranca_resultado",
  eventoRegistrar: "asaas_evento_registrar",
  eventoProcessar: "asaas_evento_processar",
  painel: "asaas_receber_painel",
} as const;
