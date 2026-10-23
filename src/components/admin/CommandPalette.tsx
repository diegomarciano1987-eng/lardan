import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, X, CornerDownLeft, Tag, Boxes, ContactRound, FileText, Compass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ALL_MODULES, moduleAllowed } from "@/lib/admin-modules";
import { useCapabilities, type Capability } from "@/lib/capabilities";
import { hasAny, type AppRole } from "@/lib/session";
import { cn } from "@/lib/utils";

export interface SearchHit {
  id: string;
  group: string;
  icon: typeof Tag;
  title: string;
  context: string;
  to: string;
  search?: Record<string, string>;
}

const LIMIT = 5;

/**
 * Busca no servidor, sempre limitada. Nunca baixa a base inteira e nunca
 * filtra no navegador: cada grupo é uma consulta paginada com RLS ativa.
 */
export type Escopo = "cadastros" | "produtos" | "maletas" | "financeiro" | "candidaturas" | "site";

export const ESCOPOS: { id: Escopo; label: string }[] = [
  { id: "cadastros", label: "Cadastros" },
  { id: "produtos", label: "Produtos e SKU" },
  { id: "maletas", label: "Maletas" },
  { id: "financeiro", label: "Financeiro" },
  { id: "candidaturas", label: "Candidaturas" },
  { id: "site", label: "Páginas do site" },
];

/** Pré-filtro: só consulta as tabelas do tipo escolhido (antes eram 10 consultas por tecla). */
async function search(term: string, caps: Capability[], escopo: Escopo): Promise<SearchHit[]> {
  const like = `%${term}%`;
  const hits: SearchHit[] = [];

  const podeCatalogo = caps.includes("catalog.view");
  const podeLeads = caps.includes("leads.view") && escopo === "candidaturas";

  const blocoCatalogo = async () => {
  if (podeCatalogo && (escopo === "produtos" || escopo === "site")) {
    const nada = Promise.resolve({ data: [] as never[] });
    const [produtos, variantes, paginas] = await Promise.all([
      escopo === "produtos" ? supabase
        .from("products")
        .select("id,name,slug,status")
        .ilike("name", like)
        .limit(LIMIT) : nada,
      escopo === "produtos" ? supabase
        .from("product_variants")
        .select("id,sku,label,product_id")
        .or(`sku.ilike.${like},label.ilike.${like}`)
        .limit(LIMIT) : nada,
      escopo === "site" ? supabase.from("pages").select("id,title,slug,status").ilike("title", like).limit(LIMIT) : nada,
    ]);

    for (const p of produtos.data ?? []) {
      hits.push({
        id: `prod-${p.id}`,
        group: "Produtos",
        icon: Tag,
        title: p.name,
        context: `Situação: ${p.status}`,
        to: "/admin/cadastros",
      });
    }
    for (const v of variantes.data ?? []) {
      hits.push({
        id: `var-${v.id}`,
        group: "SKUs",
        icon: Boxes,
        title: v.sku ?? v.label ?? "Variante",
        context: v.label ?? "Variante",
        to: "/admin/cadastros",
      });
    }
    for (const pg of paginas.data ?? []) {
      hits.push({
        id: `page-${pg.id}`,
        group: "Páginas do site",
        icon: FileText,
        title: pg.title,
        context: `/${pg.slug} — ${pg.status}`,
        to: "/admin/site",
      });
    }
  }

  };
  const blocoLeads = async () => {
  if (podeLeads) {
    const [leads, contatos] = await Promise.all([
      supabase
        .from("leads")
        .select("id,full_name,protocol,status")
        .or(`full_name.ilike.${like},protocol.ilike.${like}`)
        .limit(LIMIT),
      supabase
        .from("contact_requests")
        .select("id,full_name,protocol,status")
        .or(`full_name.ilike.${like},protocol.ilike.${like}`)
        .limit(LIMIT),
    ]);
    for (const l of leads.data ?? []) {
      hits.push({
        id: `lead-${l.id}`,
        group: "Candidaturas",
        icon: ContactRound,
        title: l.full_name,
        context: `${l.protocol} — ${l.status}`,
        to: "/admin/leads",
      });
    }
    for (const c of contatos.data ?? []) {
      hits.push({
        id: `msg-${c.id}`,
        group: "Mensagens",
        icon: ContactRound,
        title: c.full_name,
        context: `${c.protocol} — ${c.status}`,
        to: "/admin/leads",
      });
    }
  }

  };
  const blocoResto = async () => {
  if (escopo !== "cadastros" && escopo !== "maletas" && escopo !== "financeiro") return;
  const emCad = escopo === "cadastros", emKit = escopo === "maletas", emFin = escopo === "financeiro";
  // Pessoas: todas (ativas e inativas), por nome, razão social, código ou CPF/CNPJ.
  const digitos = term.replace(/\D/g, "");
  const safe = term.replace(/[,()]/g, " ");
  const likeSafe = `%${safe}%`;
  const podeFinPagar = caps.includes("finance.payable.view") || caps.includes("finance.view");
  const podeFinReceber = caps.includes("finance.receivable.view") || caps.includes("finance.view");

  const pessoaFiltro = [
    `display_name.ilike.${likeSafe}`,
    `legal_name.ilike.${likeSafe}`,
    `code.ilike.${likeSafe}`,
    ...(digitos.length >= 3 ? [`doc_masked.ilike.%${digitos.slice(-4)}%`] : []),
  ].join(",");

  type Titulo = { id: string; descricao: string | null; valor_cents: number | null; status: string; numero: number | string | null };
  const titulos = async (direction: "payable" | "receivable"): Promise<{ data: Titulo[] }> => {
    const { data, error } = await supabase.rpc("fin_titles_list" as never, {
      _direction: direction, _search: term, _limit: 6, _offset: 0, _de: null, _ate: null,
    } as never);
    if (error) return { data: [] };
    const rows = ((data as { rows?: Record<string, unknown>[] } | null)?.rows ?? []);
    return {
      data: rows.map((r) => ({
        id: String(r["id"]), descricao: (r["descricao"] as string) ?? null,
        valor_cents: (r["valor_cents"] as number) ?? (r["total_cents"] as number) ?? null,
        status: String(r["status"] ?? ""), numero: (r["numero"] as string) ?? null,
      })),
    };
  };
  const vazio = { data: [] as never[] };
  // Falha de consulta nunca vira "nada encontrado": sobe como erro honesto na tela.
  const seguro = async <T,>(p: PromiseLike<{ data: T[] | null; error?: { message: string } | null }>) => {
    const r = await p;
    if (r.error) throw new Error(r.error.message);
    return { data: r.data ?? [] };
  };

  const [pessoas, pagar, receber, maletas, contas, fornecedores] = await Promise.all([
    !emCad ? Promise.resolve(vazio) : seguro(supabase
      .from("parties")
      .select("id,display_name,legal_name,code,status,doc_masked")
      .or(pessoaFiltro)
      // Inclui inativas: a maior parte das consultoras vindas do SmallData está "inativo".
      // Só os cadastros que foram unificados em outro (duplicados) saem, logo abaixo.
      .order("display_name")
      .limit(25)),
    emFin && podeFinPagar ? titulos("payable") : Promise.resolve(vazio),
    emFin && podeFinReceber ? titulos("receivable") : Promise.resolve(vazio),
    !emKit ? Promise.resolve(vazio) : seguro(supabase.from("kits").select("id,code,label").or(`code.ilike.${likeSafe},label.ilike.${likeSafe}`).limit(LIMIT)),
    !emFin ? Promise.resolve(vazio) : seguro(supabase.from("financial_accounts").select("id,nome,kind").ilike("nome", likeSafe).limit(LIMIT)),
    !emCad ? Promise.resolve(vazio) : seguro(supabase
      .from("suppliers")
      .select("id,name,trade_name")
      .or(`name.ilike.${likeSafe},trade_name.ilike.${likeSafe}`)
      .limit(LIMIT)),
  ]);

  const reais = (c: number | null) =>
    ((c ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  let listaPessoas = (pessoas.data ?? []) as { id: string; display_name: string | null; legal_name: string | null; code: string | null; status: string | null; doc_masked: string | null }[];
  if (listaPessoas.length) {
    const dup = await supabase.from("party_unificacoes").select("duplicada_id").in("duplicada_id", listaPessoas.map((p) => p.id));
    const fora = new Set((dup.data ?? []).map((d) => d.duplicada_id as string));
    const peso = (st: string | null) => (st === "ativo" ? 0 : st === "inativo" ? 2 : 1);
    listaPessoas = listaPessoas
      .filter((p) => !fora.has(p.id) && !/^HOMOLOG\b/i.test(p.display_name ?? ""))
      .sort((a, b) => peso(a.status) - peso(b.status))
      .slice(0, 8);
  }
  for (const p of listaPessoas) {
    hits.push({
      id: `pes-${p.id}`,
      group: "Pessoas e consultoras",
      icon: ContactRound,
      title: p.display_name ?? p.legal_name ?? "Pessoa",
      context: [p.code, p.doc_masked, p.status].filter(Boolean).join(" · "),
      to: `/admin/cadastros/pessoas/${p.id}`,
    });
  }
  for (const [lista, grupo, rota] of [
    [pagar.data ?? [], "Contas a pagar", "/admin/financeiro/pagar"],
    [receber.data ?? [], "Contas a receber", "/admin/financeiro/receber"],
  ] as const) {
    for (const t of lista as { id: string; descricao: string | null; valor_cents: number | null; status: string; numero: number | null }[]) {
      hits.push({
        id: `tit-${t.id}`,
        group: grupo,
        icon: FileText,
        title: t.descricao ?? "Título",
        context: `${t.numero ? `Nº ${t.numero} · ` : ""}${reais(t.valor_cents)} · ${t.status}`,
        to: rota,
        search: { busca: t.descricao ?? term },
      });
    }
  }
  for (const k of maletas.data ?? []) {
    hits.push({ id: `kit-${k.id}`, group: "Maletas", icon: Boxes, title: k.code, context: k.label ?? "", to: "/admin/maletas" });
  }
  for (const c of contas.data ?? []) {
    hits.push({ id: `cta-${c.id}`, group: "Contas e caixas", icon: FileText, title: c.nome, context: String(c.kind), to: `/admin/financeiro/contas/${c.id}` });
  }
  for (const f of fornecedores.data ?? []) {
    hits.push({ id: `for-${f.id}`, group: "Fornecedores", icon: ContactRound, title: f.name, context: f.trade_name ?? "", to: "/admin/cadastros" });
  }

  };
  await Promise.all([blocoCatalogo(), blocoLeads(), blocoResto()]);
  return hits;
}

export function CommandPalette({
  open,
  onClose,
  roles,
}: {
  open: boolean;
  onClose: () => void;
  roles: AppRole[];
}) {
  const caps = useCapabilities();
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [cursor, setCursor] = useState(0);
  const [escopo, setEscopo] = useState<Escopo>("cadastros");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 220);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setTerm("");
      setDebounced("");
      setCursor(0);
    }
  }, [open]);

  const query = useQuery({
    queryKey: ["global-search", escopo, debounced, caps.join(",")],
    enabled: open && debounced.length >= 2,
    queryFn: () => search(debounced, caps, escopo),
    staleTime: 15_000,
  });

  // Destinos do sistema (sempre disponíveis, respeitando papel)
  const destinos = useMemo(() => {
    const t = debounced.toLowerCase();
    return ALL_MODULES.filter(
      (m) =>
        m.path &&
        moduleAllowed(m, caps, roles) &&
        (t.length < 2 || m.label.toLowerCase().includes(t)),
    ).map<SearchHit>((m) => ({
      id: `mod-${m.slug}`,
      group: "Páginas e ações",
      icon: Compass,
      title: m.label,
      context: m.description,
      to: m.path as string,
    }));
  }, [debounced, caps, roles]);

  const hits = useMemo(
    () => [...(query.data ?? []), ...destinos].slice(0, 60),
    [query.data, destinos],
  );

  useEffect(() => setCursor(0), [hits.length]);

  if (!open) return null;

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onClose();
    void navigate({ to: hit.to, ...(hit.search ? { search: hit.search } : {}) } as never);
  };

  const groups = hits.reduce<Record<string, SearchHit[]>>((acc, h) => {
    (acc[h.group] ??= []).push(h);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/45 p-4 pt-[10vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Busca global"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
          <Search aria-hidden className="size-4 text-ledger-muted" />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Tab") {
                e.preventDefault();
                const i = ESCOPOS.findIndex((x) => x.id === escopo);
                setEscopo(ESCOPOS[(i + (e.shiftKey ? ESCOPOS.length - 1 : 1)) % ESCOPOS.length]!.id);
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, hits.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              }
              if (e.key === "Enter") go(hits[cursor]);
            }}
            placeholder="Buscar por SKU, produto, código, consultora, maleta, cliente, título..."
            className="min-w-0 flex-1 bg-transparent text-sm text-ledger-text outline-none placeholder:text-ledger-muted"
          />
          {term && (
            <button
              type="button"
              onClick={() => setTerm("")}
              aria-label="Limpar busca"
              className="rounded-lg p-1 text-ledger-muted hover:bg-surface-muted"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div role="tablist" aria-label="O que você quer buscar?" className="flex flex-wrap items-center gap-1.5 border-b border-line-soft px-4 py-2">
          <span className="mr-1 text-xs font-medium text-ledger-muted">O que você quer buscar?</span>
          {ESCOPOS.map((e) => (
            <button
              key={e.id}
              type="button"
              role="tab"
              aria-selected={escopo === e.id}
              onClick={() => { setEscopo(e.id); inputRef.current?.focus(); }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                escopo === e.id ? "border-champagne bg-champagne-soft text-ledger-text" : "border-line text-ledger-muted hover:bg-surface-muted",
              )}
            >
              {e.label}
            </button>
          ))}
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-2">
          {debounced.length >= 2 && query.isFetching && (
            <p className="px-4 py-3 text-sm text-ledger-muted">Buscando…</p>
          )}
          {query.isError && (
            <p className="px-4 py-3 text-sm text-danger">
              Não foi possível concluir a busca. Tente novamente.
            </p>
          )}
          {!query.isFetching && debounced.length >= 2 && hits.length === 0 && (
            <p className="px-4 py-3 text-sm text-ledger-muted">
              Nenhum resultado autorizado para “{debounced}”.
            </p>
          )}

          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="px-2 py-1">
              <p className="ledger-eyebrow px-2 py-1">{group}</p>
              <ul>
                {items.map((h) => {
                  const index = hits.indexOf(h);
                  const Icon = h.icon;
                  return (
                    <li key={h.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setCursor(index)}
                        onClick={() => go(h)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                          index === cursor ? "bg-champagne-soft" : "hover:bg-surface-muted",
                        )}
                      >
                        <Icon aria-hidden className="size-4 shrink-0 text-bronze" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ledger-text">
                            {h.title}
                          </span>
                          <span className="block truncate text-xs text-ledger-muted">
                            {h.context}
                          </span>
                        </span>
                        <CornerDownLeft aria-hidden className="size-3.5 text-ledger-muted" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-line-soft px-4 py-2 text-[0.6875rem] text-ledger-muted">
          <span>Tab troca o tipo · Setas navegam · Enter abre · Esc fecha</span>
          <span>Busca só no tipo escolhido</span>
        </div>
      </div>
    </div>
  );
}
