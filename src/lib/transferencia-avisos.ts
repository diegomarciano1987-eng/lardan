import type { ResultadoTransferencia } from "@/lib/maletas-transferir.functions";

/** 0279: o que aconteceu na transferência, em frases curtas para o aviso da tela. */
export function avisosTransferencia(r: Partial<ResultadoTransferencia> | null | undefined): string[] {
  if (!r) return [];
  const a: string[] = [];
  if (r.voltou_do_recebimento) a.push(`${r.consultora_anterior ?? "A consultora anterior"} tinha confirmado o recebimento: o representante precisa buscar a maleta com ela.`);
  if (r.entregas_canceladas) a.push(`A entrega em mãos para ${r.consultora_anterior ?? "a consultora anterior"} foi cancelada.`);
  const p = r.promissoria;
  if (p?.antiga_recusada) a.push("A promissória antiga foi cancelada na ZapSign: o link antigo não aceita mais assinatura.");
  if (p?.antiga_pendente_fila) a.push("A ZapSign não respondeu agora: o cancelamento da promissória antiga será refeito sozinho em até 10 minutos.");
  if (p?.nova === "enviada") a.push(`Promissória nova enviada para ${r.consultora_nova ?? "a nova consultora"} assinar pelo WhatsApp.`);
  if (p?.nova === "falhou") a.push(`A promissória nova não foi enviada: ${p.aviso ?? "tente pelo botão Assinatura digital"}.`);
  if (r.pendencia_fiscal) a.push(`Nota fiscal nº ${r.nota_numero ?? "—"} está em nome de ${r.consultora_anterior ?? "outra consultora"}: a montagem recebeu a pendência para fazer a devolução e a nota nova.`);
  return a;
}
