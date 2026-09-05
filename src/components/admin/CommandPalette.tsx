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
}

const LIMIT = 5;

/**
 * Busca no servidor, sempre limitada. Nunca baixa a base inteira e nunca
 * filtra no navegador: cada grupo é uma consulta paginada com RLS ativa.
 */
async function search(term: string, caps: Capability[]): Promise<SearchHit[]> {
  const like = `%${term}%`;
  const hits: SearchHit[] = [];

  const podeCatalogo = caps.includes("catalog.view");
  const podeLeads = caps.includes("leads.view");

  if (podeCatalogo) {
    const [produtos, variantes, paginas] = await Promise.all([
      supabase
        .from("products")
        .select("id,name,slug,status")
        .ilike("name", like)
        .limit(LIMIT),
      supabase
        .from("product_variants")
        .select("id,sku,label,product_id")
        .or(`sku.ilike.${like},label.ilike.${like}`)
        .limit(LIMIT),
      supabase.from("pages").select("id,title,slug,status").ilike("title", like).limit(LIMIT),
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
    queryKey: ["global-search", debounced, caps.join(",")],
    enabled: open && debounced.length >= 2,
    queryFn: () => search(debounced, caps),
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
    () => [...(query.data ?? []), ...destinos].slice(0, 24),
    [query.data, destinos],
  );

  useEffect(() => setCursor(0), [hits.length]);

  if (!open) return null;

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onClose();
    void navigate({ to: hit.to });
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
          <span>Setas navegam · Enter abre · Esc fecha</span>
          <span>A busca consulta o servidor com limite por grupo</span>
        </div>
      </div>
    </div>
  );
}
