/**
 * Recebimento e conciliação de eventos.
 *
 * Eventos simulados percorrem exatamente o mesmo serviço que tratará eventos
 * reais. O efeito de cada evento vem da matriz gravada em asaas_event_types:
 * estado externo, efeito no recebível, efeito no dinheiro disponível, tarifa,
 * estorno e necessidade de revisão manual.
 *
 * Nenhuma baixa nasce de um evento enquanto a regra contábil não estiver
 * definida: a ocorrência fica pendente. Valor desconhecido continua
 * desconhecido — não vira zero.
 */
import type { BancoAsaas } from "./banco";
import { ROTINAS, ROTINAS_EXECUTOR } from "./banco";
import type { EventoExterno, TransporteAsaas } from "./contrato";

const TAMANHO_MAXIMO = 256 * 1024;

export interface EventoRegistrado {
  id: string;
  novo?: boolean;
  repetido?: boolean;
  processado?: boolean;
  efeito?: string;
  revisao_manual?: boolean;
  aviso?: string;
}

/** Validação local do manipulador: autenticação, conta, estrutura e tamanho. */
export function validarEnvelope(e: {
  accountId?: string | null;
  token?: string | null;
  tokenEsperado?: string | null;
  corpo: unknown;
}) {
  if (!e.accountId) throw new Error("Evento sem conta.");
  if (!e.tokenEsperado || e.token !== e.tokenEsperado) throw new Error("Evento não autenticado.");
  const texto = JSON.stringify(e.corpo ?? null);
  if (texto.length > TAMANHO_MAXIMO) throw new Error("Mensagem acima do tamanho aceito.");
  const c = e.corpo as Record<string, unknown> | null;
  if (!c || typeof c !== "object") throw new Error("Mensagem sem estrutura.");
  if (!c["id"] || !c["event"]) throw new Error("Mensagem sem identificador ou tipo.");
  return true;
}

export type OrigemEvento = "provedor" | "simulacao";

/**
 * Persiste antes de confirmar. Deduplica por conta + identificador externo.
 * Só o executor interno (banco de serviço) chama: 'provedor' depois de
 * validarEnvelope; 'simulacao' somente na demonstração isolada, com ator.
 */
export async function registrarEvento(
  servico: BancoAsaas,
  accountId: string,
  e: EventoExterno,
  origem: OrigemEvento,
  actor: string | null = null,
): Promise<EventoRegistrado> {
  return servico.rpc<EventoRegistrado>(ROTINAS_EXECUTOR.eventoRegistrar, {
    _payload: {
      account_id: accountId,
      external_id: e.id,
      event: e.event,
      charge_external_id: e.chargeExternalId,
      event_at: e.eventAt,
      payload: e.payload,
    },
    _origem: origem,
    _actor: actor,
  });
}

export const processarEvento = (banco: BancoAsaas, eventId: string) =>
  banco.rpc<EventoRegistrado>(ROTINAS.eventoProcessar, { _evento: eventId });

/** Recebe, registra (executor) e processa (conciliador). Repetido não repete efeito. */
export async function drenarEventos(
  servico: BancoAsaas,
  conciliador: BancoAsaas,
  transporte: TransporteAsaas,
  accountId: string,
  origem: OrigemEvento,
  actor: string | null = null,
) {
  const fila = await transporte.receberEventos();
  const saida: EventoRegistrado[] = [];
  for (const e of fila) {
    const reg = await registrarEvento(servico, accountId, e, origem, actor);
    saida.push(reg.novo === false ? { ...reg, repetido: true } : await processarEvento(conciliador, reg.id));
  }
  return saida;
}
