import { Eye } from "lucide-react";

/** Faixa fixa do jurídico: deixa claro que aqui só se consulta. */
export function AvisoSomenteLeitura() {
  return (
    <div role="status" data-testid="aviso-somente-leitura"
      className="flex items-center gap-2 rounded-xl border border-info/40 bg-info/10 px-4 py-3 text-sm font-semibold text-info">
      <Eye className="size-4 shrink-0" aria-hidden />
      Acesso somente para consulta. Nada pode ser movido, lançado ou alterado por este usuário.
    </div>
  );
}
