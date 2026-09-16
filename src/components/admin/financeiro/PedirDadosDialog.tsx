import * as React from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface CampoPedido {
  nome: string;
  rotulo: string;
  tipo?: "texto" | "valor" | "area";
  obrigatorio?: boolean;
  padrao?: string;
  placeholder?: string;
}

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25";

/**
 * Diálogo do sistema para pedir motivo, valor ou confirmação.
 * Substitui as janelas nativas do navegador em ações sensíveis.
 */
export function PedirDadosDialog({
  open,
  titulo,
  descricao,
  campos,
  confirmar = "Confirmar",
  onOpenChange,
  onConfirmar,
}: {
  open: boolean;
  titulo: string;
  descricao?: string;
  campos: CampoPedido[];
  confirmar?: string;
  onOpenChange: (v: boolean) => void;
  onConfirmar: (valores: Record<string, string>) => void;
}) {
  const [valores, setValores] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (open) {
      const inicial: Record<string, string> = {};
      for (const c of campos) inicial[c.nome] = c.padrao ?? "";
      setValores(inicial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-scope max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {descricao ? <DialogDescription>{descricao}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            for (const c of campos) {
              if (c.obrigatorio && !(valores[c.nome] ?? "").trim()) {
                toast.error(`Informe: ${c.rotulo}.`);
                return;
              }
            }
            onConfirmar(valores);
          }}
        >
          {campos.map((c) => (
            <label key={c.nome} className="block text-sm font-medium text-ledger-muted">
              <span className="mb-1 block">
                {c.rotulo}
                {c.obrigatorio ? " *" : ""}
              </span>
              {c.tipo === "area" ? (
                <textarea
                  rows={3}
                  value={valores[c.nome] ?? ""}
                  placeholder={c.placeholder ?? ""}
                  onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))}
                  className="w-full rounded-[10px] border border-line bg-surface p-3 text-sm text-ledger-text outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
                />
              ) : (
                <input
                  inputMode={c.tipo === "valor" ? "decimal" : "text"}
                  value={valores[c.nome] ?? ""}
                  placeholder={c.placeholder ?? ""}
                  onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))}
                  className={inputCls}
                />
              )}
            </label>
          ))}
          <DialogFooter>
            <button type="button" className="admin-btn" onClick={() => onOpenChange(false)}>
              Voltar
            </button>
            <button type="submit" className={"admin-btn-primary"}>
              {confirmar}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
