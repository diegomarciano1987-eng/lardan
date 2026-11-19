import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleDot } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { mensagemDeErro } from "@/lib/catalog";
import { GRADE_LIMITE, GRADE_PADRAO, gerarGradeAros, previaGrade, type ResultadoGrade } from "@/lib/anel-aro";

const OPCOES = Array.from({ length: GRADE_LIMITE.max }, (_, i) => ({ value: String(i + 1), label: `Aro ${String(i + 1).padStart(2, "0")}` }));

/**
 * 0338 — "Gerar grade de aros" na ficha do anel: cria de uma vez os aros que faltam (padrão 4 ao 30)
 * para imprimir as etiquetas antes da montagem. Não mexe em estoque, preço nem maletas.
 */
export function GradeAros({ productId, nome, arosExistentes }: { productId: string; nome: string; arosExistentes: (string | null)[] }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = React.useState(false);
  const [de, setDe] = React.useState<number>(GRADE_PADRAO.de);
  const [ate, setAte] = React.useState<number>(GRADE_PADRAO.ate);
  const [resultado, setResultado] = React.useState<ResultadoGrade | null>(null);
  const previa = previaGrade(de, ate, arosExistentes);

  const gerar = useMutation({
    mutationFn: () => gerarGradeAros(productId, de, ate),
    onSuccess: (r) => {
      setResultado(r);
      toast.success(r.total_criadas > 0 ? `${r.total_criadas} aro(s) criado(s). Já pode imprimir as etiquetas.` : "Todos os aros já existiam.");
      void qc.invalidateQueries({ queryKey: ["produto-variantes", productId] });
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(mensagemDeErro(e)),
  });

  return (
    <>
      <button type="button" className="admin-btn" onClick={() => { setResultado(null); setAberto(true); }}>
        <CircleDot aria-hidden className="size-4" /> Gerar grade de aros
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="admin-scope max-w-lg text-ledger-text">
          <DialogHeader>
            <DialogTitle>Gerar grade de aros</DialogTitle>
            <DialogDescription>{nome}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">
                <span className="ledger-eyebrow">Do aro</span>
                <SmartSelect options={OPCOES} value={String(de)} onChange={(v) => setDe(Number(v))} searchPlaceholder="Digite o aro" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="ledger-eyebrow">Até o aro</span>
                <SmartSelect options={OPCOES} value={String(ate)} onChange={(v) => setAte(Number(v))} searchPlaceholder="Digite o aro" />
              </label>
            </div>
            {de > ate ? (
              <p className="text-sm text-destructive">O primeiro aro precisa ser menor que o último.</p>
            ) : (
              <div className="rounded-xl border border-line-soft bg-surface-muted p-4 text-sm" data-testid="previa-grade">
                <p><strong>{previa.criar.length}</strong> aro(s) novo(s){previa.criar.length > 0 ? `: ${previa.criar.join(", ")}` : ""}.</p>
                {previa.existentes.length > 0 && (
                  <p className="mt-1 text-ledger-muted">Já existem (ficam como estão): {previa.existentes.join(", ")}.</p>
                )}
                <p className="mt-2 text-ledger-muted">
                  Cada aro ganha o código do modelo + o aro (ex.: aro 04 → final 04). Se esse número já for de outra peça, o aro recebe um código próprio. Estoque, preço e maletas não mudam.
                </p>
              </div>
            )}
            {resultado && (
              <div role="status" className="rounded-xl border border-success/40 bg-success/10 p-4 text-sm" data-testid="resultado-grade">
                <p className="font-semibold">{resultado.total_criadas} criado(s) · {resultado.total_existentes} já existiam.</p>
                {resultado.codigo_proprio.length > 0 && (
                  <p className="mt-1">Com código próprio (o número padrão já era de outra peça): {resultado.codigo_proprio.map((c) => `aro ${c.tamanho} → ${c.barcode}`).join(", ")}.</p>
                )}
                <p className="mt-1 text-ledger-muted">As linhas novas já aparecem na lista de variantes, com o botão de etiqueta.</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="admin-btn" onClick={() => setAberto(false)}>Fechar</button>
              <button type="button" className="admin-btn admin-btn-primary" disabled={gerar.isPending || de > ate || previa.criar.length === 0}
                onClick={() => gerar.mutate()}>
                {gerar.isPending ? "Gerando…" : previa.criar.length === 0 ? "Nada a criar" : `Criar ${previa.criar.length} aro(s)`}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
