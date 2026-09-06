import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, PencilLine } from "lucide-react";
import { EmptyState, Panel, StatusBadge, formatInt } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import {
  listShowcase,
  listTaxonomia,
  runBulk,
  saveTaxonomia,
  showcaseIds,
  type ShowcaseFilters,
  type Taxonomia,
  type TipoTaxonomia,
} from "@/lib/showcase";

const STATUS = [
  { value: "rascunho", label: "Rascunho" },
  { value: "revisao", label: "Em revisão" },
  { value: "publicado", label: "Publicado (visível no site)" },
  { value: "arquivado", label: "Arquivado" },
];

/** Administra a apresentação pública de categorias e coleções. */
export function ShowcaseTaxonomy({ podePublicar }: { podePublicar: boolean }) {
  const [tipo, setTipo] = React.useState<TipoTaxonomia>("categories");
  const [editando, setEditando] = React.useState<Taxonomia | null>(null);

  const lista = useQuery({
    queryKey: ["vitrine", "taxonomia", tipo],
    queryFn: () => listTaxonomia(tipo),
  });

  return (
    <div className="space-y-8">
      <Panel
        title={tipo === "categories" ? "Categorias" : "Coleções"}
        action={
          <div className="w-56">
            <SmartSelect
              options={[
                { value: "categories", label: "Categorias" },
                { value: "collections", label: "Coleções" },
              ]}
              value={tipo}
              onChange={(v) => {
                setTipo(v as TipoTaxonomia);
                setEditando(null);
              }}
              searchThreshold={99}
            />
          </div>
        }
      >
        {(lista.data ?? []).length === 0 ? (
          <EmptyState
            title="Nada cadastrado"
            description="Cadastre categorias e coleções em Cadastros para organizá-las aqui."
          />
        ) : (
          <ul className="space-y-3">
            {(lista.data ?? []).map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ledger-text">{t.name}</p>
                  <p className="truncate text-xs text-ledger-muted">
                    /{t.slug} · ordem {t.position}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={t.status === "publicado" ? "success" : "neutral"}>
                    {t.status === "publicado" ? "Publicada" : "Oculta"}
                  </StatusBadge>
                  <button type="button" className="admin-btn" onClick={() => setEditando(t)}>
                    <PencilLine aria-hidden className="size-4" /> Administrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editando && (
        <EditorTaxonomia
          tipo={tipo}
          item={editando}
          podePublicar={podePublicar}
          onClose={() => setEditando(null)}
        />
      )}
    </div>
  );
}

function EditorTaxonomia({
  tipo,
  item,
  podePublicar,
  onClose,
}: {
  tipo: TipoTaxonomia;
  item: Taxonomia;
  podePublicar: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState({
    name: item.name,
    slug: item.slug,
    description: item.description ?? "",
    seo_title: item.seo_title ?? "",
    seo_description: item.seo_description ?? "",
    position: String(item.position),
    status: item.status,
  });
  const [resultado, setResultado] = React.useState<string | null>(null);

  const filtroProdutos: ShowcaseFilters =
    tipo === "categories" ? { categoria_id: item.id } : { colecao_id: item.id };

  const produtos = useQuery({
    queryKey: ["vitrine", "taxonomia-produtos", tipo, item.id],
    queryFn: () => listShowcase({ filtros: filtroProdutos, ordem: "nome_asc", pagina: 0, porPagina: 24 }),
  });

  const prontos = useQuery({
    queryKey: ["vitrine", "taxonomia-prontos", tipo, item.id],
    queryFn: () => showcaseIds({ ...filtroProdutos, completo: true, publicado: false }, 5000),
  });

  const gravar = useMutation({
    mutationFn: () =>
      saveTaxonomia(tipo, item.id, {
        name: form.name,
        slug: form.slug,
        description: form.description || null,
        seo_title: form.seo_title || null,
        seo_description: form.seo_description || null,
        position: Number(form.position) || 0,
        status: form.status,
      }),
    onSuccess: () => {
      setResultado("Apresentação salva.");
      void qc.invalidateQueries({ queryKey: ["vitrine", "taxonomia"] });
    },
  });

  const publicarProntos = useMutation({
    mutationFn: async () => {
      const ids = prontos.data ?? [];
      return runBulk({
        acao: "publicar",
        ids,
        filtros: filtroProdutos,
        chave: crypto.randomUUID(),
        nota: `Publicação em bloco de ${tipo === "categories" ? "categoria" : "coleção"} ${item.name}`,
      });
    },
    onSuccess: (r) => {
      setResultado(`${formatInt(r.afetados)} produto(s) publicados, ${formatInt(r.rejeitados)} recusados.`);
      void qc.invalidateQueries({ queryKey: ["vitrine"] });
    },
  });

  return (
    <Panel title={`Apresentação · ${item.name}`} action={<button type="button" className="admin-btn" onClick={onClose}>Fechar</button>}>
      <div className="grid gap-5 md:grid-cols-2">
        <Campo rotulo="Título público">
          <Entrada value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        </Campo>
        <Campo rotulo="Endereço no site (slug)">
          <Entrada value={form.slug} onChange={(v) => setForm({ ...form, slug: v })} />
        </Campo>
        <Campo rotulo="Descrição">
          <Entrada value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
        </Campo>
        <Campo rotulo="Ordem no site">
          <Entrada value={form.position} onChange={(v) => setForm({ ...form, position: v })} />
        </Campo>
        <Campo rotulo="Título para buscadores (SEO)">
          <Entrada value={form.seo_title} onChange={(v) => setForm({ ...form, seo_title: v })} />
        </Campo>
        <Campo rotulo="Descrição para buscadores">
          <Entrada value={form.seo_description} onChange={(v) => setForm({ ...form, seo_description: v })} />
        </Campo>
        <Campo rotulo="Visibilidade">
          <SmartSelect
            options={STATUS}
            value={form.status}
            onChange={(v) => setForm({ ...form, status: v as Taxonomia["status"] })}
            searchThreshold={99}
            disabled={!podePublicar}
          />
        </Campo>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line-soft pt-6">
        <button type="button" className="admin-btn-primary" disabled={gravar.isPending} onClick={() => gravar.mutate()}>
          Salvar apresentação
        </button>
        {podePublicar && (
          <button
            type="button"
            className="admin-btn"
            disabled={(prontos.data ?? []).length === 0 || publicarProntos.isPending}
            onClick={() => publicarProntos.mutate()}
          >
            Publicar os {formatInt((prontos.data ?? []).length)} produtos prontos
          </button>
        )}
        {resultado && (
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-success">
            <CheckCircle2 aria-hidden className="size-4" />
            {resultado}
          </p>
        )}
      </div>

      <div className="mt-6 border-t border-line-soft pt-6">
        <p className="ledger-eyebrow">Pré-visualização dos produtos associados</p>
        {(produtos.data?.rows ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-ledger-muted">Nenhum produto associado.</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {(produtos.data?.rows ?? []).map((p) => (
              <li key={p.id} className="truncate rounded-[10px] border border-line px-3 py-2 text-sm">
                <span className="font-medium text-ledger-text">{p.name}</span>
                <span className="text-ledger-muted">
                  {" "}
                  · {p.status === "publicado" ? "publicado" : "não publicado"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ledger-muted">
          Mostrando até 24 de {formatInt(produtos.data?.total ?? 0)} produtos.
        </p>
      </div>
    </Panel>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="ledger-eyebrow">{rotulo}</span>
      {children}
    </label>
  );
}

function Entrada({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
    />
  );
}
