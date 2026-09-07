import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CheckCircle2, PencilLine, TriangleAlert } from "lucide-react";
import { EmptyState, Panel, StatusBadge, formatInt } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import {
  ROTULO_IMPEDIMENTO_TAXONOMIA,
  dependentesTaxonomia,
  despublicarTaxonomia,
  impedimentosTaxonomia,
  listShowcase,
  listTaxonomia,
  publicarTaxonomia,
  reordenarTaxonomia,
  runBulk,
  saveTaxonomia,
  showcaseIds,
  type ShowcaseFilters,
  type Taxonomia,
  type TipoTaxonomia,
} from "@/lib/showcase";

function mensagem(erro: unknown) {
  if (erro && typeof erro === "object" && "message" in erro) return String((erro as { message: string }).message);
  return "Não foi possível concluir.";
}

/** Administra a apresentação pública de categorias e coleções. */
export function ShowcaseTaxonomy({ podePublicar }: { podePublicar: boolean }) {
  const qc = useQueryClient();
  const [tipo, setTipo] = React.useState<TipoTaxonomia>("categories");
  const [editando, setEditando] = React.useState<Taxonomia | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);

  const lista = useQuery({
    queryKey: ["vitrine", "taxonomia", tipo],
    queryFn: () => listTaxonomia(tipo),
  });

  const ordenar = useMutation({
    mutationFn: (ids: string[]) => reordenarTaxonomia(tipo, ids),
    onSuccess: () => {
      setAviso("Ordem salva.");
      void qc.invalidateQueries({ queryKey: ["vitrine", "taxonomia"] });
    },
    onError: (e) => setAviso(mensagem(e)),
  });

  const itens = lista.data ?? [];

  const mover = (indice: number, direcao: -1 | 1) => {
    const alvo = indice + direcao;
    if (alvo < 0 || alvo >= itens.length) return;
    const copia = [...itens];
    const a = copia[indice]!;
    copia[indice] = copia[alvo]!;
    copia[alvo] = a;
    ordenar.mutate(copia.map((t) => t.id));
  };

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
                setAviso(null);
              }}
              searchThreshold={99}
            />
          </div>
        }
      >
        {itens.length === 0 ? (
          <EmptyState
            title="Nada cadastrado"
            description="Cadastre categorias e coleções em Cadastros para organizá-las aqui."
          />
        ) : (
          <ul className="space-y-3">
            {itens.map((t, i) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ledger-text">{t.name}</p>
                  <p className="truncate text-xs text-ledger-muted">
                    /{t.slug} · posição {i + 1}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={t.status === "publicado" ? "success" : "neutral"}>
                    {t.status === "publicado" ? "Publicada" : "Oculta"}
                  </StatusBadge>
                  <button
                    type="button"
                    className="admin-btn"
                    disabled={i === 0 || ordenar.isPending}
                    onClick={() => mover(i, -1)}
                    aria-label="Subir"
                  >
                    <ArrowUp aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="admin-btn"
                    disabled={i === itens.length - 1 || ordenar.isPending}
                    onClick={() => mover(i, 1)}
                    aria-label="Descer"
                  >
                    <ArrowDown aria-hidden className="size-4" />
                  </button>
                  <button type="button" className="admin-btn" onClick={() => setEditando(t)}>
                    <PencilLine aria-hidden className="size-4" /> Administrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {aviso && <p className="mt-4 text-sm font-semibold text-ledger-text">{aviso}</p>}
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
  });
  const [motivo, setMotivo] = React.useState("");
  const [comProdutos, setComProdutos] = React.useState<"bloquear" | "despublicar">("bloquear");
  const [resultado, setResultado] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  const filtroProdutos: ShowcaseFilters =
    tipo === "categories" ? { categoria_id: item.id } : { colecao_id: item.id };

  const produtos = useQuery({
    queryKey: ["vitrine", "taxonomia-produtos", tipo, item.id],
    queryFn: () => listShowcase({ filtros: filtroProdutos, ordem: "nome_asc", pagina: 0, porPagina: 24 }),
  });

  const impedimentos = useQuery({
    queryKey: ["vitrine", "taxonomia-impedimentos", tipo, item.id],
    queryFn: () => impedimentosTaxonomia(tipo, item.id),
  });

  const dependentes = useQuery({
    queryKey: ["vitrine", "taxonomia-dependentes", tipo, item.id],
    queryFn: () => dependentesTaxonomia(tipo, item.id),
  });

  const prontos = useQuery({
    queryKey: ["vitrine", "taxonomia-prontos", tipo, item.id],
    queryFn: () => showcaseIds({ ...filtroProdutos, completo: true, publicado: false }, 5000),
  });

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["vitrine"] });
  };

  const gravar = useMutation({
    mutationFn: () =>
      saveTaxonomia(tipo, item.id, {
        name: form.name,
        slug: form.slug,
        description: form.description,
        seo_title: form.seo_title,
        seo_description: form.seo_description,
      }),
    onSuccess: () => {
      setErro(null);
      setResultado("Conteúdo público salvo.");
      recarregar();
    },
    onError: (e) => setErro(mensagem(e)),
  });

  const publicar = useMutation({
    mutationFn: () => publicarTaxonomia(tipo, [item.id], motivo || undefined),
    onSuccess: (r) => {
      setErro(null);
      setResultado(
        r.afetados > 0
          ? "Publicada. Já aparece no site."
          : `Recusada: falta ${(r.itens_rejeitados[0]?.faltando ?? [])
              .map((f) => ROTULO_IMPEDIMENTO_TAXONOMIA[f] ?? f)
              .join(", ")}.`,
      );
      recarregar();
    },
    onError: (e) => setErro(mensagem(e)),
  });

  const despublicar = useMutation({
    mutationFn: (destino: "rascunho" | "arquivado") =>
      despublicarTaxonomia({ tipo, ids: [item.id], motivo, destino, produtos: comProdutos }),
    onSuccess: (r) => {
      setErro(null);
      setResultado(
        `Retirada do ar. ${formatInt(r.produtos_afetados)} produto(s) publicados foram afetados.`,
      );
      recarregar();
    },
    onError: (e) => setErro(mensagem(e)),
  });

  const publicarProntos = useMutation({
    mutationFn: async () =>
      runBulk({
        acao: "publicar",
        ids: prontos.data ?? [],
        filtros: filtroProdutos,
        chave: crypto.randomUUID(),
        nota: `Publicação em bloco de ${tipo === "categories" ? "categoria" : "coleção"} ${item.name}`,
      }),
    onSuccess: (r) => {
      setResultado(`${formatInt(r.afetados)} produto(s) publicados, ${formatInt(r.rejeitados)} recusados.`);
      recarregar();
    },
    onError: (e) => setErro(mensagem(e)),
  });

  const faltando = impedimentos.data ?? [];
  const publicada = item.status === "publicado";
  const dep = dependentes.data;

  return (
    <Panel
      title={`Apresentação · ${item.name}`}
      action={
        <button type="button" className="admin-btn" onClick={onClose}>
          Fechar
        </button>
      }
    >
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
        <Campo rotulo="Título para buscadores (SEO)">
          <Entrada value={form.seo_title} onChange={(v) => setForm({ ...form, seo_title: v })} />
        </Campo>
        <Campo rotulo="Descrição para buscadores">
          <Entrada value={form.seo_description} onChange={(v) => setForm({ ...form, seo_description: v })} />
        </Campo>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line-soft pt-6">
        <button type="button" className="admin-btn-primary" disabled={gravar.isPending} onClick={() => gravar.mutate()}>
          Salvar conteúdo público
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
      </div>

      {podePublicar && (
        <div className="mt-6 space-y-4 border-t border-line-soft pt-6">
          <p className="ledger-eyebrow">Visibilidade no site</p>

          {faltando.length > 0 ? (
            <p className="inline-flex items-start gap-2 text-sm text-warning">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              Falta para publicar: {faltando.map((f) => ROTULO_IMPEDIMENTO_TAXONOMIA[f] ?? f).join(", ")}.
            </p>
          ) : (
            <p className="text-sm text-ledger-muted">Conteúdo público completo.</p>
          )}

          <Campo rotulo="Motivo (obrigatório para retirar do ar)">
            <Entrada value={motivo} onChange={setMotivo} />
          </Campo>

          {publicada && (dep?.produtos_publicados ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-ledger-text">
                {formatInt(dep?.produtos_publicados ?? 0)} produto(s) publicados dependem desta{" "}
                {tipo === "categories" ? "categoria" : "coleção"}.
              </p>
              <div className="w-72">
                <SmartSelect
                  options={[
                    { value: "bloquear", label: "Impedir enquanto houver produtos publicados" },
                    { value: "despublicar", label: "Retirar do ar também os produtos dependentes" },
                  ]}
                  value={comProdutos}
                  onChange={(v) => setComProdutos(v as "bloquear" | "despublicar")}
                  searchThreshold={99}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {!publicada && (
              <button
                type="button"
                className="admin-btn-primary"
                disabled={publicar.isPending || faltando.length > 0}
                onClick={() => publicar.mutate()}
              >
                Publicar no site
              </button>
            )}
            {publicada && (
              <>
                <button
                  type="button"
                  className="admin-btn"
                  disabled={despublicar.isPending || motivo.trim() === ""}
                  onClick={() => despublicar.mutate("rascunho")}
                >
                  Retirar do ar
                </button>
                <button
                  type="button"
                  className="admin-btn"
                  disabled={despublicar.isPending || motivo.trim() === ""}
                  onClick={() => despublicar.mutate("arquivado")}
                >
                  Arquivar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {(resultado || erro) && (
        <p
          className={
            erro
              ? "mt-5 inline-flex items-center gap-2 text-sm font-semibold text-danger"
              : "mt-5 inline-flex items-center gap-2 text-sm font-semibold text-success"
          }
        >
          {erro ? <TriangleAlert aria-hidden className="size-4" /> : <CheckCircle2 aria-hidden className="size-4" />}
          {erro ?? resultado}
        </p>
      )}

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
