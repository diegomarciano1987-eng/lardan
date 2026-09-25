import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Minus, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { caminho, projetar, type Malha } from "@/lib/rede/geo";
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
}

type Filtro = "todas" | "ativas" | "inativas";

const LARGURA = 720;

/** Espalha levemente pessoas no mesmo CEP para que cada uma seja clicável. */
function espalhar(lista: Consultora[]) {
  const vistos = new Map<string, number>();
  return lista.map((c) => {
    if (c.lat == null || c.lng == null) return { c, lat: null, lng: null };
    const chave = `${c.lat.toFixed(4)}:${c.lng.toFixed(4)}`;
    const n = vistos.get(chave) ?? 0;
    vistos.set(chave, n + 1);
    if (n === 0) return { c, lat: c.lat, lng: c.lng };
    const ang = n * 2.399; // ângulo áureo
    const raio = 0.0009 * Math.sqrt(n);
    return { c, lat: c.lat + Math.sin(ang) * raio, lng: c.lng + Math.cos(ang) * raio };
  });
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
  const [zoom, setZoom] = useState(1);
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
      return (data ?? []) as unknown as Consultora[];
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

  const projecao = useMemo(() => (malha.data ? projetar(malha.data, LARGURA) : null), [malha.data]);
  const pontos = useMemo(() => espalhar(visiveis), [visiveis]);
  const semPosicao = visiveis.filter((c) => c.lat == null).length;
  const focada = foco ? todas.find((c) => c.party_id === foco) : null;

  /** Enquadra onde as consultoras estão (a área rural do município fica de fora). */
  const caixa = useMemo(() => {
    if (!projecao) return null;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const c of todas) {
      if (c.lat == null || c.lng == null) continue;
      const [x, y] = projecao.ponto(c.lng, c.lat);
      xs.push(x);
      ys.push(y);
    }
    if (xs.length < 3) return { x: 0, y: 0, w: projecao.largura, h: projecao.altura };
    xs.sort((m, n) => m - n);
    ys.sort((m, n) => m - n);
    const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]!;
    const x0 = q(xs, 0.03), x1 = q(xs, 0.97), y0 = q(ys, 0.03), y1 = q(ys, 0.97);
    const lado = Math.max(x1 - x0, y1 - y0, 40) * 1.25;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const w = Math.min(projecao.largura, lado * (projecao.largura / projecao.altura));
    const h = Math.min(projecao.altura, lado);
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }, [projecao, todas]);

  const vb = caixa
    ? (() => {
        const w = caixa.w / zoom;
        const h = caixa.h / zoom;
        return `${caixa.x + (caixa.w - w) / 2} ${caixa.y + (caixa.h - h) / 2} ${w} ${h}`;
      })()
    : "0 0 1 1";
  const escala = caixa && projecao ? (caixa.w / projecao.largura) / zoom : 1;

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
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-display text-lg font-semibold text-ledger-text">{nome}</p>
            <div className="flex gap-1">
              <button type="button" aria-label="Aproximar" className="admin-btn px-2" onClick={() => setZoom((z) => Math.min(8, z * 1.5))}>
                <Plus className="size-4" />
              </button>
              <button type="button" aria-label="Afastar" className="admin-btn px-2" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>
                <Minus className="size-4" />
              </button>
            </div>
          </div>
          {!projecao || pessoas.isLoading ? (
            <p className="py-24 text-center text-sm text-ledger-muted">Desenhando a cidade…</p>
          ) : (
            <svg viewBox={vb} className="w-full transition-all" role="group" aria-label={`Consultoras em ${nome}`}>
              {malha.data!.features.map((f) => (
                <path
                  key={f.properties.codarea}
                  d={caminho(f.geometry, projecao)}
                  fill="color-mix(in oklab, var(--muted) 30%, white)"
                  stroke="color-mix(in oklab, var(--foreground) 30%, transparent)"
                  strokeWidth={1.2 * escala}
                />
              ))}
              {pontos.map(({ c, lat, lng }) => {
                if (lat == null || lng == null) return null;
                const [x, y] = projecao.ponto(lng, lat);
                const ativa = c.status === "ativo";
                const r = (foco === c.party_id ? 7 : 4) * escala;
                return (
                  <circle
                    key={c.party_id}
                    cx={x}
                    cy={y}
                    r={r}
                    fill={ativa ? "var(--rose)" : "color-mix(in oklab, var(--foreground) 45%, transparent)"}
                    stroke="white"
                    strokeWidth={0.8 * escala}
                    className="cursor-pointer"
                    onMouseEnter={() => setFoco(c.party_id)}
                    onClick={() => setFoco(c.party_id)}
                  >
                    <title>{`${c.nome}${c.codigo ? ` · ${c.codigo}` : ""} · ${ativa ? "ativa" : "inativa"}${c.bairro ? ` · ${c.bairro}` : ""}`}</title>
                  </circle>
                );
              })}
            </svg>
          )}
          {focada ? (
            <div className="absolute bottom-3 left-3 max-w-xs rounded-md border border-line-soft bg-surface px-3 py-2 text-xs shadow-sm">
              <p className="font-semibold text-ledger-text">{focada.nome}</p>
              <p className="text-ledger-muted">
                {[focada.codigo, focada.status === "ativo" ? "Ativa" : "Inativa", focada.bairro].filter(Boolean).join(" · ")}
              </p>
              <Link to="/admin/cadastros/pessoas/$id" params={{ id: focada.party_id }} className="admin-link mt-1 inline-block">
                Abrir ficha
              </Link>
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-ledger-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full" style={{ background: "var(--rose)" }} /> Ativa
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-ledger-muted" /> Inativa
            </span>
            <span>Posição pelo CEP, não pelo número da casa.</span>
            {semPosicao > 0 ? <span>{formatInt(semPosicao)} sem CEP localizado (aparecem só na lista).</span> : null}
          </div>
        </div>

        <div className="space-y-3">
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
                    onClick={() => setFoco(c.party_id)}
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
