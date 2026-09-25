import { lazy, Suspense, useMemo, useState } from "react";
import { ClientOnly, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ExternalLink, MapPin, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Malha } from "@/lib/rede/geo";
import type { GrupoCep } from "./MapaCidadeLeaflet";
import { obterMalha } from "@/lib/rede/rede.functions";
import { formatInt } from "@/components/admin/ui";
import { cn } from "@/lib/utils";

interface Consultora {
  party_id: string;
  nome: string;
  codigo: string | null;
  status: string;
  lat: number | null;
  lng: number | null;
  precisao: string | null;
  bairro: string | null;
  cep: string | null;
  geo_fonte: string | null;
}

type Filtro = "todas" | "ativas" | "inativas";

const MapaCidadeLeaflet = lazy(() => import("./MapaCidadeLeaflet"));

const fmtCep = (c: string | null) => {
  const d = (c ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : null;
};

/** Um ponto por CEP. Coordenada compartilhada por vários CEPs = centro da cidade/bairro → aproximado. */
function agrupar(lista: Consultora[]): { grupos: GrupoCep[]; porChave: Map<string, Consultora[]> } {
  const porChave = new Map<string, Consultora[]>();
  const cepsPorCoord = new Map<string, Set<string>>();
  for (const c of lista) {
    if (c.lat == null || c.lng == null) continue;
    const cep = fmtCep(c.cep);
    const coord = `${c.lat.toFixed(5)}:${c.lng.toFixed(5)}`;
    const chave = cep ?? `xy:${coord}`;
    (porChave.get(chave) ?? porChave.set(chave, []).get(chave)!).push(c);
    (cepsPorCoord.get(coord) ?? cepsPorCoord.set(coord, new Set()).get(coord)!).add(chave);
  }
  const grupos: GrupoCep[] = [];
  for (const [chave, ps] of porChave) {
    const p = ps[0]!;
    const coord = `${p.lat!.toFixed(5)}:${p.lng!.toFixed(5)}`;
    const aproximado = (cepsPorCoord.get(coord)?.size ?? 0) > 2 || /bairro/i.test(p.geo_fonte ?? "");
    grupos.push({
      chave,
      lat: p.lat!,
      lng: p.lng!,
      cep: fmtCep(p.cep),
      total: ps.length,
      ativas: ps.filter((x) => x.status === "ativo").length,
      aproximado,
    });
  }
  return { grupos, porChave };
}

export function CidadeConsultoras({
  ibge,
  nome,
  uf,
  onVoltar,
}: {
  ibge: string;
  nome: string;
  uf: string;
  onVoltar: () => void;
}) {
  const buscarMalha = useServerFn(obterMalha);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");
  const [cepSel, setCepSel] = useState<string | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  const [bairro, setBairro] = useState<string | null>(null);

  const malha = useQuery({
    queryKey: ["rede-malha-mun", ibge],
    queryFn: async () =>
      ((await buscarMalha({ data: { nivel: "municipio", codigoUf: ibge } })) as unknown as { malha: Malha }).malha,
    staleTime: 1000 * 60 * 60,
  });

  const pessoas = useQuery({
    queryKey: ["rede-cidade", ibge],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("network_geo_municipio_consultoras" as never, { _ibge: ibge } as never);
      if (error) throw error;
      return ((data ?? []) as unknown as Consultora[]).map((c) => {
        const lat = c.lat == null ? null : Number(c.lat);
        const lng = c.lng == null ? null : Number(c.lng);
        const ok = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
        return { ...c, lat: ok ? lat : null, lng: ok ? lng : null };
      });
    },
  });

  const todas = pessoas.data ?? [];
  const ativas = todas.filter((c) => c.status === "ativo").length;
  const termo = busca.trim().toLowerCase();
  const visiveis = useMemo(
    () =>
      todas.filter(
        (c) =>
          (filtro === "todas" || (filtro === "ativas" ? c.status === "ativo" : c.status !== "ativo")) &&
          (!bairro || (c.bairro ?? "Sem bairro") === bairro) &&
          (!termo || c.nome.toLowerCase().includes(termo) || (c.codigo ?? "").toLowerCase().includes(termo)),
      ),
    [todas, filtro, termo, bairro],
  );

  const bairros = useMemo(() => {
    const m = new Map<string, { total: number; inativas: number }>();
    for (const c of todas) {
      const b = c.bairro?.trim() || "Sem bairro";
      const v = m.get(b) ?? { total: 0, inativas: 0 };
      v.total++;
      if (c.status !== "ativo") v.inativas++;
      m.set(b, v);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 12);
  }, [todas]);

  const { grupos, porChave } = useMemo(() => agrupar(visiveis), [visiveis]);
  const semPosicao = visiveis.filter((c) => c.lat == null).length;
  const aproximadas = grupos.filter((g) => g.aproximado).reduce((n, g) => n + g.total, 0);
  const noCep = cepSel ? porChave.get(cepSel) ?? [] : [];
  const grupoSel = grupos.find((g) => g.chave === cepSel);
  const chaveDe = (c: Consultora) => {
    if (c.lat == null || c.lng == null) return null;
    return fmtCep(c.cep) ?? `xy:${c.lat.toFixed(5)}:${c.lng.toFixed(5)}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" className="admin-btn" onClick={onVoltar}>
            <ArrowLeft aria-hidden className="size-4" /> Voltar para {uf}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Numero rotulo="Consultoras" valor={todas.length} />
          <Numero rotulo="Ativas" valor={ativas} />
          <Numero rotulo="Inativas" valor={todas.length - ativas} destaque />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="ledger-panel relative overflow-hidden p-3">
          <p className="mb-2 font-display text-lg font-semibold text-ledger-text">{nome}</p>
          {pessoas.isLoading ? (
            <p className="py-24 text-center text-sm text-ledger-muted">Carregando consultoras…</p>
          ) : (
            <ClientOnly fallback={<div className="h-[640px] rounded-[12px] bg-surface-muted" />}>
              <Suspense fallback={<div className="h-[640px] rounded-[12px] bg-surface-muted" />}>
                <MapaCidadeLeaflet
                  grupos={grupos}
                  contorno={(malha.data as unknown as GeoJSON.GeoJsonObject) ?? null}
                  selecionado={cepSel}
                  onSelecionar={setCepSel}
                />
              </Suspense>
            </ClientOnly>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-ledger-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full" style={{ background: "var(--rose)" }} /> Ativa
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-ledger-muted" /> Inativa
            </span>
            <span>Um ponto por CEP; o número indica quantas moram nele.</span>
            {aproximadas > 0 ? <span>Borda tracejada: {formatInt(aproximadas)} com CEP localizado só pelo bairro/centro.</span> : null}
            {semPosicao > 0 ? <span>{formatInt(semPosicao)} sem CEP localizado (aparecem só na lista).</span> : null}
          </div>
        </div>

        <div className="space-y-3">
          {cepSel ? (
            <div className="ledger-panel space-y-2 border-bronze/50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1.5 font-display text-base font-semibold text-ledger-text">
                    <MapPin aria-hidden className="size-4 text-bronze" /> {grupoSel?.cep ? `CEP ${grupoSel.cep}` : "Local no mapa"}
                  </p>
                  <p className="text-xs text-ledger-muted">
                    {formatInt(noCep.length)} consultora(s){noCep[0]?.bairro ? ` · ${noCep[0].bairro}` : ""}
                    {grupoSel?.aproximado ? " · posição aproximada" : ""}
                  </p>
                </div>
                <button type="button" aria-label="Fechar" className="admin-btn px-2" onClick={() => setCepSel(null)}>
                  <X className="size-4" />
                </button>
              </div>
              <ul className="max-h-[300px] divide-y divide-line-soft overflow-y-auto">
                {noCep.map((c) => (
                  <li key={c.party_id} className="flex items-center gap-2 py-2">
                    <span
                      className={cn("inline-block size-2 shrink-0 rounded-full", c.status !== "ativo" && "bg-ledger-muted")}
                      style={c.status === "ativo" ? { background: "var(--rose)" } : undefined}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ledger-text">{c.nome}</p>
                      <p className="text-xs text-ledger-muted">{[c.codigo, c.status === "ativo" ? "Ativa" : "Inativa"].filter(Boolean).join(" · ")}</p>
                    </div>
                    <Link to="/admin/cadastros/pessoas/$id" params={{ id: c.party_id }} className="admin-btn shrink-0 text-xs">
                      Cadastro <ExternalLink aria-hidden className="size-3.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="ledger-panel space-y-3 p-4">
            <div className="flex gap-1">
              {(["todas", "ativas", "inativas"] as Filtro[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFiltro(f)}
                  className={cn(filtro === f ? "admin-btn-primary text-warm-ivory" : "admin-btn", "flex-1 capitalize")}
                >
                  {f}
                </button>
              ))}
            </div>
            <label className="relative block">
              <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ledger-muted" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar consultora por nome ou código"
                className="h-10 w-full rounded-[10px] border border-line bg-surface pl-9 pr-3 text-sm text-ledger-text outline-none focus:border-bronze"
              />
            </label>
            <p className="text-xs text-ledger-muted">
              {formatInt(visiveis.length)} consultora(s){bairro ? ` em ${bairro}` : ""}
              {bairro ? (
                <button type="button" className="admin-link ml-2" onClick={() => setBairro(null)}>
                  limpar bairro
                </button>
              ) : null}
            </p>
            <ul className="max-h-[360px] divide-y divide-line-soft overflow-y-auto">
              {visiveis.slice(0, 400).map((c) => (
                <li key={c.party_id}>
                  <button
                    type="button"
                    onMouseEnter={() => setFoco(c.party_id)}
                    onClick={() => {
                      setFoco(c.party_id);
                      const k = chaveDe(c);
                      if (k) setCepSel(k);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-1 py-2 text-left text-sm hover:bg-surface-muted",
                      foco === c.party_id && "bg-surface-muted",
                    )}
                  >
                    <span
                      className={cn("inline-block size-2 shrink-0 rounded-full", c.status !== "ativo" && "bg-ledger-muted")}
                      style={c.status === "ativo" ? { background: "var(--rose)" } : undefined}
                    />
                    <span className="min-w-0 flex-1 truncate text-ledger-text">{c.nome}</span>
                    <span className="truncate text-xs text-ledger-muted">{c.bairro ?? ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="ledger-panel p-4">
            <p className="mb-2 text-xs uppercase tracking-[0.08em] text-ledger-muted">Bairros com mais consultoras</p>
            <ul className="space-y-1.5">
              {bairros.map(([b, v]) => (
                <li key={b}>
                  <button type="button" onClick={() => setBairro(b === bairro ? null : b)} className="w-full text-left">
                    <div className="flex justify-between text-xs">
                      <span className={cn("truncate", b === bairro ? "font-semibold text-bronze" : "text-ledger-text")}>{b}</span>
                      <span className="num text-ledger-muted">
                        {v.total} · {v.inativas} inativas
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(v.total / (bairros[0]?.[1].total || 1)) * 100}%`, background: "var(--rose)" }}
                      />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={cn("rounded-[10px] border px-3 py-1.5", destaque ? "border-bronze/40 bg-surface-muted" : "border-line bg-surface")}>
      <span className="text-xs text-ledger-muted">{rotulo} </span>
      <span className="num font-semibold text-ledger-text">{formatInt(valor)}</span>
    </div>
  );
}
