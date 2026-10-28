/** Presentation only: money and commission come from the official remessa RPC. */
export function progressoMaleta(vendidoCents: number, totalCents: number) {
  const total = Math.max(0, totalCents);
  const vendido = Math.max(0, vendidoCents);
  return { total, vendido, percentual: total > 0 ? Math.min(100, (vendido / total) * 100) : 0 };
}

/** Fail closed on first read; a failed background read never erases a successful result. */
export function estadoAceite(pendentes: readonly unknown[] | undefined) {
  return pendentes === undefined ? "verificando" : pendentes.length > 0 ? "pendente" : "liberada";
}