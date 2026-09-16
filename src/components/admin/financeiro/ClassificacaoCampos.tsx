import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { classificarTitulo, fetchClassificacoes, type FinDirection } from "@/lib/financeiro";

export interface ValoresClassificacao {
  business_entity_id: string;
  chart_account_id: string;
  cost_center_id: string;
  payment_method_id: string;
  financial_account_id: string;
}

export const CLASSIFICACAO_VAZIA: ValoresClassificacao = {
  business_entity_id: "",
  chart_account_id: "",
  cost_center_id: "",
  payment_method_id: "",
  financial_account_id: "",
};

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * Seletores de classificação com busca no servidor. Todos são opcionais:
 * o título pode ficar "Pendente de classificação" em vez de receber
 * valores inventados.
 */
export function CamposClassificacao({
  direction,
  valores,
  onChange,
  mostrarConta = true,
}: {
  direction: FinDirection;
  valores: ValoresClassificacao;
  onChange: (v: ValoresClassificacao) => void;
  mostrarConta?: boolean;
}) {
  const [busca, setBusca] = React.useState("");
  const q = useQuery({
    queryKey: ["fin-classificacoes", direction, busca, valores.business_entity_id],
    queryFn: () =>
      fetchClassificacoes({
        direction,
        ...(busca ? { busca } : {}),
        ...(valores.business_entity_id ? { entidade_id: valores.business_entity_id } : {}),
      }),
    staleTime: 30_000,
  });
  const d = q.data;
  const set = (campo: keyof ValoresClassificacao, valor: string) =>
    onChange({ ...valores, [campo]: valor });

  const vazio = (rotulo: string) => [{ value: "", label: rotulo }];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar conta contábil, centro de custo, entidade…"
          className={inputCls}
        />
      </div>
      <Campo label="Entidade">
        <SmartSelect
          options={[
            ...vazio("Sem entidade"),
            ...(d?.entidades ?? []).map((e) => ({ value: e.id, label: e.nome })),
          ]}
          value={valores.business_entity_id}
          onChange={(v) => set("business_entity_id", v)}
          placeholder="Sem entidade"
        />
      </Campo>
      <Campo label="Conta contábil">
        <SmartSelect
          options={[
            ...vazio("Pendente de classificação"),
            ...(d?.planos ?? []).map((p) => ({
              value: p.id,
              label: `${p.codigo} · ${p.nome}`,
              hint: p.natureza,
            })),
          ]}
          value={valores.chart_account_id}
          onChange={(v) => set("chart_account_id", v)}
          placeholder="Pendente de classificação"
        />
      </Campo>
      <Campo label="Centro de custo">
        <SmartSelect
          options={[
            ...vazio("Pendente de classificação"),
            ...(d?.centros ?? []).map((c) => ({ value: c.id, label: `${c.codigo} · ${c.nome}` })),
          ]}
          value={valores.cost_center_id}
          onChange={(v) => set("cost_center_id", v)}
          placeholder="Pendente de classificação"
        />
      </Campo>
      <Campo label="Forma de pagamento">
        <SmartSelect
          options={[
            ...vazio("Não informada"),
            ...(d?.formas ?? []).map((f) => ({ value: f.id, label: f.nome })),
          ]}
          value={valores.payment_method_id}
          onChange={(v) => set("payment_method_id", v)}
          placeholder="Não informada"
        />
      </Campo>
      {mostrarConta ? (
        <Campo label="Conta ou caixa prevista">
          <SmartSelect
            options={[
              ...vazio("Não definida"),
              ...(d?.contas ?? []).map((c) => ({ value: c.id, label: c.nome })),
            ]}
            value={valores.financial_account_id}
            onChange={(v) => set("financial_account_id", v)}
            placeholder="Não definida"
          />
        </Campo>
      ) : null}
      {d && d.planos.length === 0 && d.centros.length === 0 ? (
        <p className="sm:col-span-2 text-xs font-medium text-ledger-muted">
          Ainda não há plano de contas nem centros de custo cadastrados. O título pode ser gravado
          como pendente de classificação e classificado depois.
        </p>
      ) : null}
    </div>
  );
}

/** Classificação oficial de um título já gravado, com motivo e histórico. */
export function ClassificarTituloDialog({
  open,
  onOpenChange,
  tituloId,
  direction,
  atualizadoEm,
  exigeMotivo,
  iniciais,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tituloId: string;
  direction: FinDirection;
  atualizadoEm?: string;
  exigeMotivo: boolean;
  iniciais: ValoresClassificacao;
}) {
  const qc = useQueryClient();
  const [valores, setValores] = React.useState<ValoresClassificacao>(iniciais);
  const [motivo, setMotivo] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setValores(iniciais);
      setMotivo("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tituloId]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (exigeMotivo && !motivo.trim()) {
        throw new Error("Este título já tem baixa: informe o motivo da reclassificação.");
      }
      return classificarTitulo({
        title_id: tituloId,
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
        ...(atualizadoEm ? { esperado_updated_at: atualizadoEm } : {}),
        business_entity_id: valores.business_entity_id || null,
        chart_account_id: valores.chart_account_id || null,
        cost_center_id: valores.cost_center_id || null,
        payment_method_id: valores.payment_method_id || null,
        financial_account_id: valores.financial_account_id || null,
      });
    },
    onSuccess: () => {
      toast.success("Classificação registrada no histórico do título.");
      void qc.invalidateQueries({ queryKey: ["fin-titles"] });
      void qc.invalidateQueries({ queryKey: ["fin-title"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-scope max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Classificar título</DialogTitle>
          <DialogDescription>
            O histórico anterior não é apagado: cada alteração fica registrada com autor, data e
            motivo.
          </DialogDescription>
        </DialogHeader>

        <CamposClassificacao direction={direction} valores={valores} onChange={setValores} />

        <div className="mt-4 space-y-1.5">
          <span className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
            Motivo {exigeMotivo ? "(obrigatório)" : "(opcional)"}
          </span>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className={inputCls}
            placeholder="Por que esta classificação está sendo alterada?"
          />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="admin-btn" onClick={() => onOpenChange(false)}>
            Cancelar
          </button>
          <button
            type="button"
            className="admin-btn-primary"
            disabled={salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? "Gravando…" : "Gravar classificação"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
