import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ADMIN_SUBMODULES } from "@/lib/admin-modules";
import { useAdminRoles } from "@/components/admin/AdminShell";
import { hasAny } from "@/lib/session";
import { ModuleAvailabilityBadge, PageHeader, Panel } from "@/components/admin/ui";
import { can, useCapabilities } from "@/lib/capabilities";
import { lerMarkupGlobal, salvarMarkupGlobal } from "@/lib/produto";
import { mensagemDeErro } from "@/lib/catalog";

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  component: Configuracoes,
  head: () => ({
    meta: [
      { title: "Configurações — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function Configuracoes() {
  const roles = useAdminRoles();
  const itens = ADMIN_SUBMODULES.filter((m) => hasAny(roles, m.roles));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="GOVERNANÇA"
        title="Configurações"
        description="Usuários e papéis, integrações e parâmetros do sistema."
      />
      <MargemPadrao />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {itens.map((m) => (
          <Panel key={m.slug} flush>
            <div className="space-y-3 px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg text-ledger-text">{m.label}</h2>
                <ModuleAvailabilityBadge state={m.state} />
              </div>
              <p className="text-sm text-ledger-muted">{m.description}</p>
              {m.path && (
                <Link to={m.path} className="admin-link">
                  Abrir
                </Link>
              )}
            </div>
          </Panel>
        ))}
        {itens.length === 0 && (
          <p className="text-sm text-ledger-muted">
            O seu perfil não tem acesso a nenhuma configuração.
          </p>
        )}
      </div>
    </div>
  );
}

function MargemPadrao() {
  const qc = useQueryClient();
  const caps = useCapabilities();
  const pode = can(caps, "product.manage");
  const [valor, setValor] = useState("");

  const atual = useQuery({ queryKey: ["catalog-markup"], queryFn: lerMarkupGlobal });

  useEffect(() => {
    if (atual.data != null) setValor(String(atual.data).replace(".", ","));
  }, [atual.data]);

  const salvar = useMutation({
    mutationFn: async () => {
      const n = Number(valor.replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(n) || n < 0) throw new Error("Informe uma margem válida, por exemplo 180.");
      return salvarMarkupGlobal(n);
    },
    onSuccess: () => {
      toast.success("Margem padrão atualizada.");
      void qc.invalidateQueries({ queryKey: ["catalog-markup"] });
    },
    onError: (e) => toast.error(mensagemDeErro(e)),
  });

  return (
    <Panel title="Margem padrão do catálogo (markup)">
      <div className="space-y-3">
        <p className="text-sm text-ledger-muted">
          Margem aplicada sobre o preço de custo para sugerir o preço de venda de todos os produtos.
          Cada produto pode ter uma margem própria na sua ficha, que prevalece sobre esta.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-ledger-muted">
            <span className="mb-1 block">Margem padrão (%)</span>
            <input
              className="w-40 rounded-md border border-line-soft bg-paper px-3 py-2 text-sm text-ledger-text outline-none focus-visible:ring-2 focus-visible:ring-champagne disabled:opacity-60"
              value={valor}
              inputMode="decimal"
              disabled={!pode}
              onChange={(e) => setValor(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="admin-btn border-champagne"
            disabled={!pode || salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? "Salvando…" : "Salvar margem"}
          </button>
        </div>
        {!pode ? (
          <p className="text-sm text-ledger-muted">
            Somente o perfil Master altera a margem padrão.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
