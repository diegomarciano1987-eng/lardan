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
import { ROTINAS } from "./banco";
import type { EventoExterno, TransporteAsaas } from "./contrato";

const TAMANHO_MAXIMO = 256 * 1024;

export interface EventoRegistrado {
  id: string;
  repetido: boolean;
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

/** Persiste antes de confirmar. Deduplica por conta + identificador externo. */
export async function registrarEvento(banco: BancoAsaas, accountId: string, e: EventoExterno): Promise<EventoRegistrado> {
  return banco.rpc<EventoRegistrado>(ROTINAS.eventoRegistrar, {
    _payload: {
      account_id: accountId,
      external_id: e.id,
      event_type: e.event,
      charge_external_id: e.chargeExternalId,
      event_at: e.eventAt,
      payload: e.payload,
    },
  });
}

export const processarEvento = (banco: BancoAsaas, eventId: string) =>
  banco.rpc<EventoRegistrado>(ROTINAS.eventoProcessar, { _event: eventId });

/** Recebe, registra e processa a fila. Repetido não repete efeito. */
export async function drenarEventos(banco: BancoAsaas, transporte: TransporteAsaas, accountId: string) {
  const fila = await transporte.receberEventos();
  const saida: EventoRegistrado[] = [];
  for (const e of fila) {
    const reg = await registrarEvento(banco, accountId, e);
    saida.push(reg.repetido ? reg : await processarEvento(banco, reg.id));
  }
  return saida;
}
