import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Loader2, CornerDownLeft } from "lucide-react";
import { searchRegistry, type SearchHit } from "@/lib/registry";
import { cn } from "@/lib/utils";

/** Destaca o trecho encontrado sem usar HTML bruto. */
function Realce({ texto, termo }: { texto: string; termo: string }) {
  const t = termo.trim();
  if (!t) return <>{texto}</>;
  const i = texto.toLowerCase().indexOf(t.toLowerCase());
  if (i < 0) return <>{texto}</>;
  return (
    <>
      {texto.slice(0, i)}
      <mark className="rounded bg-champagne-soft px-0.5 text-ink">{texto.slice(i, i + t.length)}</mark>
      {texto.slice(i + t.length)}
    </>
  );
}

/**
 * Busca unificada da Central: consulta o servidor com atraso curto,
 * cancela a consulta anterior e agrupa os resultados por tipo.
 */
export function GlobalRegistrySearch() {
  const navigate = useNavigate();
  const [termo, setTermo] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = termo.trim();
    abortRef.current?.abort();
    if (t.length < 2) {
      setHits([]);
      setCarregando(false);
      setErro(null);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setCarregando(true);
    const id = window.setTimeout(() => {
      searchRegistry(t, ctrl.signal)
        .then((r) => {
          if (ctrl.signal.aborted) return;
          setHits(r);
          setErro(null);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setErro(e instanceof Error ? e.message : "Falha na busca.");
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setCarregando(false);
        });
    }, 280);
    return () => {
      window.clearTimeout(id);
      ctrl.abort();
    };
  }, [termo]);

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  const grupos = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const lista = map.get(h.grupo) ?? [];
      lista.push(h);
      map.set(h.grupo, lista);
    }
    return [...map.entries()];
  }, [hits]);

  const ir = (rota: string) => {
    setAberto(false);
    void navigate({ to: rota as never });
  };

  return (
    <div ref={boxRef} className="relative w-full">
      <label className="relative block">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ledger-muted" />
        <input
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          placeholder="Buscar pessoa, empresa, CPF/CNPJ, telefone, SKU, código de barras, produto…"
          aria-label="Busca unificada de cadastros"
          className="h-12 w-full rounded-xl border border-line bg-surface pr-10 pl-10 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25"
        />
        {carregando && (
          <Loader2 aria-hidden className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-bronze" />
        )}
      </label>

      {aberto && termo.trim().length >= 2 && (
        <div className="absolute z-40 mt-2 max-h-[26rem] w-full overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-2xl">
          {erro ? (
            <p className="px-3 py-4 text-sm font-medium text-danger">{erro}</p>
          ) : hits.length === 0 && !carregando ? (
            <p className="px-3 py-4 text-sm font-medium text-ledger-muted">
              Nada encontrado para “{termo.trim()}”. O registro pode não existir ainda — use “Novo cadastro”.
            </p>
          ) : (
            grupos.map(([grupo, lista]) => (
              <section key={grupo} className="mb-1 last:mb-0">
                <p className="ledger-eyebrow px-3 pt-2 pb-1">{grupo}</p>
                <ul>
                  {lista.map((h) => (
                    <li key={`${h.tipo}-${h.entity_id}`}>
                      <button
                        type="button"
                        onClick={() => ir(h.rota)}
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                          "hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ledger-text">
                            <Realce texto={h.titulo} termo={termo} />
                          </span>
                          {h.subtitulo && (
                            <span className="num block truncate text-xs font-medium text-ledger-muted">
                              <Realce texto={h.subtitulo} termo={termo} />
                            </span>
                          )}
                        </span>
                        {h.selo && (
                          <span className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[0.65rem] font-semibold tracking-[0.08em] text-ledger-muted uppercase">
                            {h.selo}
                          </span>
                        )}
                        <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-ledger-muted opacity-0 group-hover:opacity-100" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}
