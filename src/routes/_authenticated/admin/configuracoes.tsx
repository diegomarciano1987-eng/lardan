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
import { supabase } from "@/integrations/supabase/client";
import { PARAMETROS_PADRAO, type ParametrosRemessa } from "@/lib/remessa";
import { ConfigPedido, PrecoNovo } from "@/components/admin/config/PedidoEPreco";
import { LiderELiga } from "@/components/admin/config/LiderELiga";
import { TelefonesRepetidos } from "@/components/admin/config/TelefonesRepetidos";

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
      <ParametrosRemessaPanel />
      <PrecoNovo master={roles.includes("master" as never)} />
      <ConfigPedido master={roles.includes("master" as never)} />
      <LiderELiga master={roles.includes("master" as never)} />
      <TelefonesRepetidos master={roles.includes("master" as never)} />
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
      if (!Number.isFinite(n) || n < 0)
        throw new Error("Informe uma margem válida, por exemplo 180.");
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

const CAMPOS_REMessa: { chave: keyof ParametrosRemessa; rotulo: string; ajuda: string }[] = [
  { chave: "pecas_cliente_nova", rotulo: "Total de peças da maleta", ajuda: "Tamanho da maleta padrão (cliente nova e base da escada)." },
  { chave: "meta_colares", rotulo: "Colares", ajuda: "Quantidade de colares na maleta padrão." },
  { chave: "meta_pulseiras", rotulo: "Pulseiras", ajuda: "Quantidade de pulseiras na maleta padrão." },
  { chave: "meta_aneis", rotulo: "Anéis", ajuda: "Quantidade de anéis na maleta padrão." },
  { chave: "meta_tornozeleiras", rotulo: "Tornozeleiras", ajuda: "Quantidade de tornozeleiras na maleta padrão." },
];

/** Parâmetros de montagem das remessas — o que cada maleta precisa ter por tipo de peça. */
function ParametrosRemessaPanel() {
  const qc = useQueryClient();
  const caps = useCapabilities();
  const pode = can(caps, "kit.manage");
  const [valores, setValores] = useState<ParametrosRemessa>(PARAMETROS_PADRAO);

  const atual = useQuery({
    queryKey: ["remessa-parametros"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("remessa_parametros" as never)
        .select("pecas_cliente_nova, meta_colares, meta_pulseiras, meta_aneis, meta_tornozeleiras")
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as ParametrosRemessa | null) ?? PARAMETROS_PADRAO;
    },
  });

  useEffect(() => {
    if (atual.data) setValores(atual.data);
  }, [atual.data]);

  const brincos = Math.max(
    valores.pecas_cliente_nova - valores.meta_colares - valores.meta_pulseiras - valores.meta_aneis - valores.meta_tornozeleiras,
    0,
  );

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("remessa_parametros_salvar" as never, {
        _pecas_cliente_nova: valores.pecas_cliente_nova,
        _meta_colares: valores.meta_colares,
        _meta_pulseiras: valores.meta_pulseiras,
        _meta_aneis: valores.meta_aneis,
        _meta_tornozeleiras: valores.meta_tornozeleiras,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parâmetros de remessa atualizados.");
      void qc.invalidateQueries({ queryKey: ["remessa-parametros"] });
    },
    onError: (e) => toast.error(mensagemDeErro(e)),
  });

  return (
    <Panel title="Parâmetros de montagem das remessas">
      <div className="space-y-4">
        <p className="text-sm text-ledger-muted">
          Definem a meta de cada maleta na tela de bipagem: o total de peças e quantas de cada tipo.
          Os brincos recebem automaticamente o restante do total — hoje seriam{" "}
          <strong className="text-ledger-text">{brincos} brincos</strong>.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {CAMPOS_REMessa.map((c) => (
            <label key={c.chave} className="text-sm text-ledger-muted">
              <span className="mb-1 block">{c.rotulo}</span>
              <input
                type="number"
                min={c.chave === "pecas_cliente_nova" ? 1 : 0}
                className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm text-ledger-text outline-none focus-visible:ring-2 focus-visible:ring-champagne disabled:opacity-60"
                value={valores[c.chave]}
                disabled={!pode}
                onChange={(e) =>
                  setValores((v) => ({ ...v, [c.chave]: Math.max(0, Number(e.target.value) || 0) }))
                }
              />
              <span className="mt-1 block text-xs">{c.ajuda}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="admin-btn border-champagne"
            disabled={!pode || salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? "Salvando…" : "Salvar parâmetros"}
          </button>
          {!pode ? (
            <p className="text-sm text-ledger-muted">
              Somente quem gerencia as remessas altera estes parâmetros.
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
