/**
 * Portas de acesso ao banco usadas pelos serviços do Asaas.
 *
 * Duas portas distintas:
 *  - banco do USUÁRIO (sessão do navegador; RLS e capacidades valem): prepara
 *    intenção, importa, aprova, lê painéis;
 *  - banco do EXECUTOR interno (papel de serviço do servidor): grava o que o
 *    provedor devolveu, eventos e links. O navegador nunca chega nele.
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
  eventoProcessar: "asaas_evento_processar",
  parcelas: "asaas_receber_parcelas",
  fila: "asaas_receber_fila",
  ocorrencias: "asaas_receber_ocorrencias",
  contas: "asaas_receber_contas",
} as const;

/** Somente executor interno (service_role). */
export const ROTINAS_EXECUTOR = {
  reservar: "asaas_exec_reservar",
  cliente: "asaas_exec_cliente",
  resultado: "asaas_exec_resultado",
  link: "asaas_exec_link",
  cobranca: "asaas_exec_cobranca",
  pendentes: "asaas_exec_pendentes",
  eventoRegistrar: "asaas_evento_registrar",
  config: "asaas_exec_config",
  configIntencao: "asaas_exec_config_intencao",
  configCobranca: "asaas_exec_config_cobranca",
  configLote: "asaas_exec_config_lote",
  clienteReservar: "asaas_exec_cliente_reservar",
  clienteEstado: "asaas_exec_cliente_estado",
  adiar: "asaas_exec_adiar",
  revisao: "asaas_exec_revisao",
} as const;
