import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, ImagePlus, Plus, Star, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  PageHeader,
  Panel,
  StatusBadge,
  EmptyState,
  ErrorState,
  Skeleton,
  formatBRLFromCents,
  formatDateTime,
} from "@/components/admin/ui";
import { RecordSheet, type RecordValues } from "@/components/admin/RecordSheet";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { fetchMyRoles, hasAny, type AppRole } from "@/lib/session";
import {
  saveRecord,
  uploadMedia,
  signedMediaUrl,
  parseCentavos,
  centavosParaTexto,
  slugify,
  STATUS_OPTIONS,
} from "@/lib/catalog";

export const Route = createFileRoute("/_authenticated/admin/cadastros/produtos_/$id")({
  component: ProdutoDetalhe,
  head: () => ({
    meta: [
      { title: "Ficha do produto — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const tone = (status: string) =>
  status === "publicado" ? "success" : status === "arquivado" ? "neutral" : "warning";

function ProdutoDetalhe() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const papeis = useQuery({ queryKey: ["meus-papeis"], queryFn: fetchMyRoles });
  const podeVerCustos = hasAny(papeis.data ?? [], [
    "master",
    "diretoria",
    "financeiro",
    "estoque",
  ] as AppRole[]);

  const [editarFicha, setEditarFicha] = useState(false);
  const [variante, setVariante] = useState<VarianteRow | null>(null);
  const [varianteAberta, setVarianteAberta] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const produto = useQuery({
    queryKey: ["produto", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const variantes = useQuery({
    queryKey: ["produto-variantes", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_variants")
        .select("*")
        .eq("product_id", id)
        .order("position");
      if (error) throw error;
      return data ?? [];
    },
  });

  const custos = useQuery({
    queryKey: ["produto-custos", id],
    enabled: podeVerCustos && (variantes.data?.length ?? 0) > 0,
    queryFn: async () => {
      const ids = (variantes.data ?? []).map((v) => v.id);
      const { data, error } = await supabase
        .from("variant_costs")
        .select("id, variant_id, cost_cents, effective_from, note")
        .in("variant_id", ids)
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const imagens = useQuery({
    queryKey: ["produto-imagens", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_media")
        .select("id, position, media:media_assets(id, alt, url, storage_path)")
        .eq("product_id", id)
        .order("position");
      if (error) throw error;
      return data ?? [];
    },
  });

  const historico = useQuery({
    queryKey: ["produto-historico", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, entity, created_at")
        .eq("entity_id", id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const categorias = useQuery({
    queryKey: ["opcoes-categorias"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const colecoes = useQuery({
    queryKey: ["opcoes-colecoes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collections").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const fornecedores = useQuery({
    queryKey: ["opcoes-fornecedores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ["produto", id] });
    void qc.invalidateQueries({ queryKey: ["produto-variantes", id] });
    void qc.invalidateQueries({ queryKey: ["produto-imagens", id] });
    void qc.invalidateQueries({ queryKey: ["produto-historico", id] });
    void qc.invalidateQueries({ queryKey: ["products"] });
  };

  /** Publica/despublica sempre pela operação canônica do banco. */
  const aplicarSituacao = async (status: string) => {
    if (status === "publicado") {
      const r = await publicarProdutos([id], "ficha do produto");
      if (r.afetados === 0) {
        const faltando = r.itens_rejeitados[0]?.faltando ?? (await impedimentosPublicacao(id));
        throw new Error(
          `Ainda não é possível publicar. Falta: ${faltando
            .map((f) => ROTULO_IMPEDIMENTO[f] ?? f)
            .join(", ")}.`,
        );
      }
      return;
    }
    if (p?.status === "publicado") {
      await despublicarProdutos([id], "ficha do produto", status as "rascunho" | "revisao" | "arquivado");
      return;
    }
    await saveRecord("products", { status }, id);
  };

  const salvarFicha = useMutation({
    mutationFn: async (v: RecordValues) => {
      const nome = String(v["name"] ?? "").trim();
      const status = String(v["status"] || "rascunho");
      const gravado = await saveRecord(
        "products",
        {
          name: nome,
          slug: String(v["slug"] || "").trim() || slugify(nome),
          legacy_code: v["legacy_code"] || null,
          category_id: v["category_id"] || null,
          collection_id: v["collection_id"] || null,
          supplier_id: v["supplier_id"] || null,
          short_description: v["short_description"] || null,
          description: v["description"] || null,
          material: v["material"] || null,
          plating: v["plating"] || null,
          measurements: v["measurements"] || null,
          weight_grams: v["weight_grams"] === "" || v["weight_grams"] == null ? null : Number(v["weight_grams"]),
          care_instructions: v["care_instructions"] || null,
          warranty_text: v["warranty_text"] || null,
          price_cents: parseCentavos(String(v["preco"] ?? "")),
          price_is_public: v["price_is_public"] !== false,
          seo_title: v["seo_title"] || null,
          seo_description: v["seo_description"] || null,
          is_featured: v["is_featured"] === true,
        },
        id,
      );
      if (status !== (p?.status ?? "rascunho")) await aplicarSituacao(status);
      return gravado;
    },
    onSuccess: () => {
      toast.success("Ficha salva.");
      invalidar();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const mudarStatus = useMutation({
    mutationFn: async (status: string) => aplicarSituacao(status),
    onSuccess: () => {
      toast.success("Situação atualizada.");
      invalidar();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível atualizar."),
  });


  const salvarVariante = useMutation({
    mutationFn: async (v: RecordValues) => {
      const payload = {
        product_id: id,
        label: String(v["label"] ?? "").trim(),
        sku: v["sku"] || null,
        barcode: v["barcode"] || null,
        legacy_code: v["legacy_code"] || null,
        size: v["size"] || null,
        color: v["color"] || null,
        price_cents: parseCentavos(String(v["preco"] ?? "")),
        position: Number(v["position"] ?? 0) || 0,
        is_default: v["is_default"] === true,
        is_active: v["is_active"] !== false,
      };
      const row = await saveRecord<VarianteRow>("product_variants", payload, variante?.id);
      const custoTexto = String(v["custo"] ?? "").trim();
      if (podeVerCustos && custoTexto) {
        const centavos = parseCentavos(custoTexto);
        if (centavos != null) {
          const { error } = await supabase.from("variant_costs").insert({
            variant_id: row.id,
            cost_cents: centavos,
            ...(v["supplier_id"] ? { supplier_id: String(v["supplier_id"]) } : {}),
            ...(v["custo_nota"] ? { note: String(v["custo_nota"]) } : {}),
          });
          if (error) throw error;
        }
      }
      return row;
    },
    onSuccess: () => {
      toast.success("Variante salva.");
      invalidar();
      void qc.invalidateQueries({ queryKey: ["produto-custos", id] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const enviarImagem = useMutation({
    mutationFn: async (file: File) => {
      const media = await uploadMedia(file, file.name);
      const { error } = await supabase.from("product_media").insert({
        product_id: id,
        media_id: media.id,
        position: imagens.data?.length ?? 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Imagem adicionada.");
      invalidar();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível enviar."),
  });

  /** Reescreve a ordem inteira: a primeira imagem é sempre a principal. */
  const reordenar = useMutation({
    mutationFn: async (ids: string[]) => {
      for (let i = 0; i < ids.length; i++) {
        const { error } = await supabase
          .from("product_media")
          .update({ position: i })
          .eq("id", ids[i] as string);
        if (error) throw error;
      }
    },
    onSuccess: () => invalidar(),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível reordenar."),
  });

  const removerImagem = useMutation({
    mutationFn: async (vinculoId: string) => {
      const { error } = await supabase.from("product_media").delete().eq("id", vinculoId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Imagem removida do produto.");
      invalidar();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível remover."),
  });

  const salvarAlt = useMutation({
    mutationFn: async ({ mediaId, alt }: { mediaId: string; alt: string }) => {
      const { error } = await supabase.from("media_assets").update({ alt }).eq("id", mediaId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Descrição da imagem atualizada.");
      invalidar();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const ordemAtual = (imagens.data ?? []).map((m) => m.id);
  const moverImagem = (index: number, direcao: -1 | 1) => {
    const destino = index + direcao;
    if (destino < 0 || destino >= ordemAtual.length) return;
    const nova = [...ordemAtual];
    const a = nova[index] as string;
    nova[index] = nova[destino] as string;
    nova[destino] = a;
    reordenar.mutate(nova);
  };
  const tornarPrincipal = (index: number) => {
    if (index === 0) return;
    const nova = [...ordemAtual];
    const [alvo] = nova.splice(index, 1);
    nova.unshift(alvo as string);
    reordenar.mutate(nova);
  };

  const p = produto.data;

  const fichaInicial = useMemo<RecordValues>(() => {
    if (!p) return {};
    return {
      name: p.name,
      slug: p.slug,
      legacy_code: p.legacy_code ?? "",
      category_id: p.category_id ?? "",
      collection_id: p.collection_id ?? "",
      supplier_id: p.supplier_id ?? "",
      short_description: p.short_description ?? "",
      description: p.description ?? "",
      material: p.material ?? "",
      plating: p.plating ?? "",
      measurements: p.measurements ?? "",
      weight_grams: p.weight_grams ?? "",
      care_instructions: p.care_instructions ?? "",
      warranty_text: p.warranty_text ?? "",
      preco: p.price_cents == null ? "" : centavosParaTexto(p.price_cents),
      price_is_public: p.price_is_public,
      seo_title: p.seo_title ?? "",
      seo_description: p.seo_description ?? "",
      is_featured: p.is_featured,
      status: p.status,
    };
  }, [p]);

  if (produto.isLoading) return <Skeleton className="h-64 w-full" />;
  if (produto.error || !p)
    return (
      <ErrorState
        message={produto.error instanceof Error ? produto.error.message : "Produto não encontrado."}
        onRetry={() => void produto.refetch()}
      />
    );

  return (
    <div className="space-y-6">
      <Link to="/admin/cadastros/produtos" className="admin-btn w-fit">
        <ArrowLeft aria-hidden className="size-4" /> Voltar aos produtos
      </Link>

      <PageHeader
        eyebrow="Produto"
        title={p.name}
        description={`Endereço no site: /${p.slug}`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone={tone(p.status)}>{p.status}</StatusBadge>
            {p.status === "publicado" ? (
              <Link to="/produto/$slug" params={{ slug: p.slug }} target="_blank" className="admin-btn">
                <ExternalLink aria-hidden className="size-4" /> Ver no site
              </Link>
            ) : null}
            <SmartSelect
              value={p.status}
              onChange={(v) => mudarStatus.mutate(v)}
              options={STATUS_OPTIONS}
              placeholder="Situação"
              className="w-48"
            />
            <button type="button" className="admin-btn border-champagne" onClick={() => setEditarFicha(true)}>
              Editar ficha
            </button>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Panel title="Variantes vendáveis">
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                className="admin-btn border-champagne"
                onClick={() => {
                  setVariante(null);
                  setVarianteAberta(true);
                }}
              >
                <Plus aria-hidden className="size-4" /> Nova variante
              </button>
            </div>
            {variantes.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (variantes.data?.length ?? 0) === 0 ? (
              <EmptyState
                title="Nenhuma variante"
                description="Cadastre ao menos uma variante para movimentar estoque e vender."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-ledger-muted">
                    <tr>
                      <th className="py-2 pr-4 font-normal">Variante</th>
                      <th className="py-2 pr-4 font-normal">SKU</th>
                      <th className="py-2 pr-4 font-normal">Código de barras</th>
                      <th className="py-2 pr-4 text-right font-normal">Preço</th>
                      {podeVerCustos ? (
                        <th className="py-2 pr-4 text-right font-normal">Custo atual</th>
                      ) : null}
                      <th className="py-2 font-normal">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(variantes.data ?? []).map((v) => {
                      const custo = custos.data?.find((c) => c.variant_id === v.id);
                      return (
                        <tr
                          key={v.id}
                          className="cursor-pointer border-t border-line-soft hover:bg-surface-muted"
                          onClick={() => {
                            setVariante(v);
                            setVarianteAberta(true);
                          }}
                        >
                          <td className="py-2 pr-4 text-ledger-text">
                            <span className="inline-flex items-center gap-2">
                              {v.is_default ? <Star aria-hidden className="size-3.5 text-bronze" /> : null}
                              {v.label}
                            </span>
                          </td>
                          <td className="num py-2 pr-4">{v.sku ?? "—"}</td>
                          <td className="num py-2 pr-4">{v.barcode ?? "—"}</td>
                          <td className="num py-2 pr-4 text-right">
                            {v.price_cents == null ? "—" : formatBRLFromCents(v.price_cents)}
                          </td>
                          {podeVerCustos ? (
                            <td className="num py-2 pr-4 text-right">
                              {custo ? formatBRLFromCents(custo.cost_cents) : "—"}
                            </td>
                          ) : null}
                          <td className="py-2">
                            <StatusBadge tone={v.is_active ? "success" : "neutral"}>
                              {v.is_active ? "Ativa" : "Inativa"}
                            </StatusBadge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Imagens">
            <div className="mb-4 flex justify-end">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) enviarImagem.mutate(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="admin-btn border-champagne"
                onClick={() => fileRef.current?.click()}
                disabled={enviarImagem.isPending}
              >
                <ImagePlus aria-hidden className="size-4" />
                {enviarImagem.isPending ? "Enviando…" : "Adicionar imagem"}
              </button>
            </div>
            {(imagens.data?.length ?? 0) === 0 ? (
              <EmptyState title="Sem imagens" description="Envie as fotos da peça para exibir no site." />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(imagens.data ?? []).map((m, i) => {
                  const media = m.media as { id: string; alt: string; storage_path: string | null } | null;
                  return (
                    <ImagemCard
                      key={m.id}
                      path={media?.storage_path ?? null}
                      alt={media?.alt ?? "Imagem do produto"}
                      principal={i === 0}
                      podeVoltar={i > 0}
                      podeAvancar={i < (imagens.data?.length ?? 0) - 1}
                      onVoltar={() => moverImagem(i, -1)}
                      onAvancar={() => moverImagem(i, 1)}
                      onPrincipal={() => tornarPrincipal(i)}
                      onRemover={() => removerImagem.mutate(m.id)}
                      onAlt={(alt) => media && salvarAlt.mutate({ mediaId: media.id, alt })}
                    />
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Preço público">
            <p className="num text-2xl text-ledger-text">
              {p.price_cents == null ? "Sem preço" : formatBRLFromCents(p.price_cents)}
            </p>
            <p className="mt-1 text-sm text-ledger-muted">
              {p.price_is_public ? "Visível no site quando publicado." : "Uso interno: não aparece no site."}
            </p>
            <p className="mt-2 text-sm text-ledger-muted">
              {p.is_featured ? "Peça marcada como destaque na vitrine." : "Sem destaque na vitrine."}
            </p>
          </Panel>

          <Panel title="Histórico">
            {(historico.data?.length ?? 0) === 0 ? (
              <EmptyState title="Sem registros" description="Nenhuma alteração auditada até agora." />
            ) : (
              <ul className="space-y-2 text-sm">
                {(historico.data ?? []).map((h) => (
                  <li key={h.id} className="flex justify-between gap-3 border-b border-line-soft pb-2">
                    <span className="text-ledger-text">{h.action}</span>
                    <span className="num text-ledger-muted">{formatDateTime(h.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <RecordSheet
        open={editarFicha}
        onOpenChange={setEditarFicha}
        title="Editar ficha do produto"
        description="Toda alteração fica registrada na auditoria."
        initial={fichaInicial}
        fields={[
          { name: "name", label: "Nome", type: "text", required: true, full: true },
          { name: "slug", label: "Endereço (slug)", type: "text" },
          { name: "legacy_code", label: "Código legado", type: "text" },
          {
            name: "category_id",
            label: "Categoria",
            type: "select",
            options: (categorias.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          },
          {
            name: "collection_id",
            label: "Coleção",
            type: "select",
            options: (colecoes.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          },
          {
            name: "supplier_id",
            label: "Fornecedor",
            type: "select",
            options: (fornecedores.data ?? []).map((f) => ({ value: f.id, label: f.name })),
          },
          { name: "status", label: "Situação", type: "select", options: STATUS_OPTIONS, required: true },
          { name: "preco", label: "Preço (R$)", type: "text", placeholder: "0,00" },
          { name: "price_is_public", label: "Mostrar preço no site", type: "switch" },
          { name: "is_featured", label: "Destaque na vitrine", type: "switch" },
          { name: "material", label: "Material", type: "text" },
          { name: "plating", label: "Banho", type: "text" },
          { name: "measurements", label: "Medidas", type: "text" },
          { name: "weight_grams", label: "Peso (g)", type: "number" },
          { name: "short_description", label: "Resumo", type: "textarea", full: true },
          { name: "description", label: "Descrição completa", type: "textarea", full: true },
          { name: "care_instructions", label: "Cuidados", type: "textarea" },
          { name: "warranty_text", label: "Garantia", type: "textarea" },
          { name: "seo_title", label: "Título para buscadores", type: "text", full: true },
          { name: "seo_description", label: "Descrição para buscadores", type: "textarea", full: true },
        ]}
        onSubmit={async (v) => {
          await salvarFicha.mutateAsync(v);
        }}
      />

      <RecordSheet
        open={varianteAberta}
        onOpenChange={setVarianteAberta}
        title={variante ? `Editar variante — ${variante.label}` : "Nova variante"}
        description="SKU e código de barras são únicos quando informados."
        initial={
          variante
            ? {
                label: variante.label,
                sku: variante.sku ?? "",
                barcode: variante.barcode ?? "",
                legacy_code: variante.legacy_code ?? "",
                size: variante.size ?? "",
                color: variante.color ?? "",
                preco: variante.price_cents == null ? "" : centavosParaTexto(variante.price_cents),
                position: variante.position,
                is_default: variante.is_default,
                is_active: variante.is_active,
              }
            : { is_active: true }
        }
        fields={[
          { name: "label", label: "Nome da variante", type: "text", required: true, full: true },
          { name: "sku", label: "SKU", type: "text" },
          { name: "barcode", label: "Código de barras", type: "text" },
          { name: "legacy_code", label: "Código legado", type: "text" },
          { name: "size", label: "Tamanho", type: "text" },
          { name: "color", label: "Cor", type: "text" },
          { name: "preco", label: "Preço (R$)", type: "text", placeholder: "0,00" },
          { name: "position", label: "Ordem", type: "number" },
          { name: "is_default", label: "Variante padrão", type: "switch" },
          { name: "is_active", label: "Ativa", type: "switch" },
          ...(podeVerCustos
            ? ([
                {
                  name: "custo",
                  label: "Novo custo (R$)",
                  type: "text" as const,
                  placeholder: "0,00",
                  help: "Deixe vazio para não registrar custo agora.",
                },
                {
                  name: "supplier_id",
                  label: "Fornecedor do custo",
                  type: "select" as const,
                  options: (fornecedores.data ?? []).map((f) => ({ value: f.id, label: f.name })),
                },
                { name: "custo_nota", label: "Observação do custo", type: "text" as const },
              ])
            : []),
        ]}
        onSubmit={async (v) => {
          await salvarVariante.mutateAsync(v);
        }}
      />
    </div>
  );
}

interface VarianteRow {
  id: string;
  label: string;
  sku: string | null;
  barcode: string | null;
  legacy_code: string | null;
  size: string | null;
  color: string | null;
  price_cents: number | null;
  position: number;
  is_default: boolean;
  is_active: boolean;
}

function ImagemCard({
  path,
  alt,
  principal,
  podeVoltar,
  podeAvancar,
  onVoltar,
  onAvancar,
  onPrincipal,
  onRemover,
  onAlt,
}: {
  path: string | null;
  alt: string;
  principal: boolean;
  podeVoltar: boolean;
  podeAvancar: boolean;
  onVoltar: () => void;
  onAvancar: () => void;
  onPrincipal: () => void;
  onRemover: () => void;
  onAlt: (alt: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [texto, setTexto] = useState(alt);
  useEffect(() => setTexto(alt), [alt]);
  useEffect(() => {
    let vivo = true;
    if (!path) return;
    void signedMediaUrl(path).then((u) => {
      if (vivo) setUrl(u);
    });
    return () => {
      vivo = false;
    };
  }, [path]);
  return (
    <figure className="overflow-hidden rounded-lg border border-line-soft bg-surface-muted">
      <div className="relative">
        {url ? (
          <img src={url} alt={alt} loading="lazy" className="aspect-square w-full object-cover" />
        ) : (
          <div className="aspect-square w-full animate-pulse bg-surface-muted" />
        )}
        {principal ? (
          <span className="absolute left-2 top-2 rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-champagne">
            Principal
          </span>
        ) : null}
      </div>
      <figcaption className="space-y-2 p-2">
        <label className="sr-only" htmlFor={`alt-${path ?? "sem"}`}>
          Descrição da imagem
        </label>
        <input
          id={`alt-${path ?? "sem"}`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => {
            const limpo = texto.trim();
            if (limpo && limpo !== alt) onAlt(limpo);
          }}
          placeholder="Descreva a imagem"
          className="w-full rounded-md border border-line-soft bg-paper px-2 py-1 text-xs text-ledger-text outline-none focus-visible:ring-2 focus-visible:ring-champagne"
        />
        <div className="flex items-center justify-between gap-1">
          <div className="flex gap-1">
            <button
              type="button"
              className="admin-btn px-2 py-1"
              onClick={onVoltar}
              disabled={!podeVoltar}
              aria-label="Mover para trás"
            >
              <ChevronLeft aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              className="admin-btn px-2 py-1"
              onClick={onAvancar}
              disabled={!podeAvancar}
              aria-label="Mover para frente"
            >
              <ChevronRight aria-hidden className="size-3.5" />
            </button>
          </div>
          <div className="flex gap-1">
            {!principal ? (
              <button
                type="button"
                className="admin-btn px-2 py-1"
                onClick={onPrincipal}
                aria-label="Tornar principal"
              >
                <Star aria-hidden className="size-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              className="admin-btn px-2 py-1"
              onClick={onRemover}
              aria-label="Remover imagem do produto"
            >
              <Trash2 aria-hidden className="size-3.5" />
            </button>
          </div>
        </div>
      </figcaption>
    </figure>
  );
}
