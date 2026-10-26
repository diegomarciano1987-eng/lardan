import { lazy, Suspense, useMemo, useState } from "react";
import { ClientOnly, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ExternalLink, LocateFixed, MapPin, Search, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Malha } from "@/lib/rede/geo";
import type { PontoMapa, Voo } from "./MapaCidadeLeaflet";
import { localizarEnderecos, obterMalha } from "@/lib/rede/rede.functions";
import { espalhar, semAcento } from "@/lib/rede/geocode-regras";
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
  rua: string | null;
  numero: string | null;
  geo_fonte: string | null;
  geo_status: string | null;
}

type Filtro = "todas" | "ativas" | "inativas";
type Onde = "rua" | "cep" | "cidade";

const MapaCidadeLeaflet = lazy(() => import("./MapaCidadeLeaflet"));

const fmtCep = (c: string | null) => {
  const d = (c ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : null;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Onde a bolinha está: na rua, pelo CEP ou no centro da cidade (sem posição própria). */
export function ondeEsta(c: Pick<Consultora, "lat" | "precisao">): Onde {
  if (c.lat == null || c.precisao === "estado" || c.precisao === "municipio" || c.precisao == null) return "cidade";
  return c.precisao === "endereco" ? "rua" : "cep";
}

/** Centro do contorno do município (caixa envolvente), para quem ainda não tem posição. */
function centroDaMalha(m: unknown): { lat: number; lng: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visitar = (v: unknown) => {
    if (Array.isArray(v)) {
      if (typeof v[0] === "number" && typeof v[1] === "number") {
        minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
        minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
      } else v.forEach(visitar);
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if ("coordinates" in o) visitar(o.coordinates);
      if ("geometry" in o) visitar(o.geometry);
      if ("features" in o) visitar(o.features);
      if ("geometries" in o) visitar(o.geometries);
    }
  };
  visitar(m);
  return Number.isFinite(minX) ? { lat: (minY + maxY) / 2, lng: (minX + maxX) / 2 } : null;
}

export function CidadeConsultoras({
  ibge,
  nome,
  uf,
  onVoltar,
  podeGerir = false,
}: {
  ibge: string;
  nome: string;
  uf: string;
  onVoltar: () => void;
  podeGerir?: boolean;
}) {
  const buscarMalha = useServerFn(obterMalha);
  const localizar = useServerFn(localizarEnderecos);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [voo, setVoo] = useState<Voo | null>(null);
  const [bairro, setBairro] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<{ feitos: number; restantes: number } | null>(null);

  const malha = useQuery({
    queryKey: ["rede-malha-mun", ibge],
    queryFn: async () =>
      ((await buscarMalha({ data: { nivel: "municipio", codigoUf: ibge } })) as unknown as { malha: Malha }).malha,
    staleTime: 1000 * 60 * 60,
  });

  const pessoas = useQuery({
    queryKey: ["rede-cidade", ibge],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("network_geo_municipio_consultoras_v2", { _ibge: ibge });
      if (error) throw error;
      return ((data ?? []) as unknown as Consultora[]).map((c) => {
        const lat = c.lat == null ? null : Number(c.lat);
        const lng = c.lng == null ? null : Number(c.lng);
        const ok = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
        return { ...c, lat: ok ? lat : null, lng: ok ? lng : null };
      });
    },
  });

  const centro = useMemo(() => centroDaMalha(malha.data), [malha.data]);
  const todas = pessoas.data ?? [];
  const ativas = todas.filter((c) => c.status === "ativo").length;
  const termo = semAcento(busca);
  const termoDig = busca.replace(/\D/g, "");

  const visiveis = useMemo(
    () =>
      todas.filter((c) => {
        if (filtro !== "todas" && (filtro === "ativas") !== (c.status === "ativo")) return false;
        if (bairro && (c.bairro?.trim() || "Sem bairro") !== bairro) return false;
        if (!termo) return true;
        const texto = semAcento([c.nome, c.codigo, c.rua, c.bairro].filter(Boolean).join(" "));
        const cepOk = termoDig.length >= 5 && (c.cep ?? "").startsWith(termoDig);
        return cepOk || termo.split(" ").every((p) => texto.includes(p));
      }),
    [todas, filtro, termo, termoDig, bairro],
  );

  const bairros = useMemo(() => {
    const m = new Map<string, { total: number; ativas: number }>();
    for (const c of todas) {
      const b = c.bairro?.trim() || "Sem bairro";
      const v = m.get(b) ?? { total: 0, ativas: 0 };
      v.total++;
      if (c.status === "ativo") v.ativas++;
      m.set(b, v);
    }
    return [...m.entries()].sort((a, b) => b[1].ativas - a[1].ativas || b[1].total - a[1].total).slice(0, 12);
  }, [todas]);

  /** Toda consultora vira um ponto: sem posição própria fica no centro da cidade, tracejada. */
  const { pontos, porId } = useMemo(() => {
    const base: (Consultora & { lat: number; lng: number; onde: Onde })[] = [];
    for (const c of visiveis) {
      const onde = ondeEsta(c);
      const p = onde === "cidade" ? centro ?? (c.lat != null ? { lat: c.lat, lng: c.lng! } : null) : { lat: c.lat!, lng: c.lng! };
      if (p) base.push({ ...c, lat: p.lat, lng: p.lng, onde });
    }
    const abertos = espalhar(base);
    const porId = new Map(abertos.map((p) => [p.party_id, p]));
    const pontos: PontoMapa[] = abertos.map((p) => ({
      id: p.party_id,
      lat: p.latV,
      lng: p.lngV,
      ativa: p.status === "ativo",
      aproximado: p.onde !== "rua",
      dica: `<strong>${esc(p.nome)}</strong>${p.codigo ? ` · ${esc(p.codigo)}` : ""}<br/>${p.status === "ativo" ? "Ativa" : "Inativa"}${
        p.rua ? `<br/>${esc(p.rua)}${p.numero ? `, ${esc(p.numero)}` : ""}` : ""
      }${p.bairro ? `<br/>${esc(p.bairro)}` : ""}${fmtCep(p.cep) ? ` · CEP ${fmtCep(p.cep)}` : ""}${
        p.onde === "cidade" ? "<br/><em>sem rua localizada: centro da cidade</em>" : p.onde === "cep" ? "<br/><em>posição pelo CEP</em>" : ""
      }`,
    }));
    return { pontos, porId };
  }, [visiveis, centro]);

  const contagem = useMemo(() => {
    const r = { rua: 0, cep: 0, cidade: 0 };
    for (const c of visiveis) r[ondeEsta(c)]++;
    return r;
  }, [visiveis]);

  const escolher = (id: string) => {
    setSel(id);
    const p = porId.get(id);
    if (p) setVoo({ lat: p.latV, lng: p.lngV, zoom: p.onde === "rua" ? 17 : 15, seq: Date.now() });
  };
  const selecionada = sel ? porId.get(sel) : undefined;

  async function localizarCidade() {
    let feitos = 0;
    setProgresso({ feitos: 0, restantes: 0 });
    try {
      for (let i = 0; i < 60; i++) {
        const r = (await localizar({ data: { limite: 20, ibge } })) as { processados: number; restantes: number; mensagem: string | null };
        if (r.mensagem === "Já existe um lote em andamento.") {
          await new Promise((ok) => setTimeout(ok, 5000));
          continue;
        }
        feitos += r.processados;
        setProgresso({ feitos, restantes: r.restantes });
        void pessoas.refetch();
        if (r.restantes === 0 || r.processados === 0) break;
      }
      toast.success(`${formatInt(feitos)} endereço(s) de ${nome} conferidos no mapa.`);
    } catch {
      toast.error("Não foi possível localizar os endereços agora. Tente de novo em alguns minutos.");
    } finally {
      setProgresso(null);
      void pessoas.refetch();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="admin-btn" onClick={onVoltar}>
            <ArrowLeft aria-hidden className="size-4" /> Voltar para {uf}
          </button>
          {podeGerir ? (
            <button type="button" className="admin-btn-primary" disabled={!!progresso} onClick={() => void localizarCidade()}>
              <LocateFixed aria-hidden className="size-4" />
              {progresso
                ? `Localizando… ${formatInt(progresso.feitos)} feitos${progresso.restantes ? ` · faltam ${formatInt(progresso.restantes)}` : ""}`
                : `Localizar ruas de ${nome}`}
            </button>
          ) : null}
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
          ) : pessoas.error ? (
            <p className="py-24 text-center text-sm text-ledger-muted">Não foi possível ler as consultoras desta cidade.</p>
          ) : (
            <ClientOnly fallback={<div className="h-[640px] rounded-[12px] bg-surface-muted" />}>
              <Suspense fallback={<div className="h-[640px] rounded-[12px] bg-surface-muted" />}>
                <MapaCidadeLeaflet
                  pontos={pontos}
                  contorno={(malha.data as unknown as GeoJSON.GeoJsonObject) ?? null}
                  selecionado={sel}
                  onSelecionar={escolher}
                  voo={voo}
                />
              </Suspense>
            </ClientOnly>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ledger-muted" data-testid="legenda-mapa">
            <span className="flex items-center gap-1.5">
              <span className="mapa-legenda-ativa inline-block size-3.5 rounded-full" /> Ativa
            </span>
            <span className="flex items-center gap-1.5">
              <span className="mapa-legenda-inativa inline-block size-2 rounded-full" /> Inativa
            </span>
            <span>
              No mapa: <strong className="text-ledger-text">{formatInt(pontos.length)}</strong> de {formatInt(visiveis.length)} ·{" "}
              {formatInt(contagem.rua)} na rua · {formatInt(contagem.cep)} pelo CEP · {formatInt(contagem.cidade)} no centro da cidade (borda tracejada)
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {selecionada ? (
            <div className="ledger-panel space-y-2 border-bronze/50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-display text-base font-semibold text-ledger-text">
                    <MapPin aria-hidden className="size-4 shrink-0 text-bronze" />
                    <span className="truncate">{selecionada.nome}</span>
                  </p>
                  <p className="text-xs text-ledger-muted">
                    {[selecionada.codigo, selecionada.status === "ativo" ? "Ativa" : "Inativa"].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <button type="button" aria-label="Fechar" className="admin-btn px-2" onClick={() => setSel(null)}>
                  <X className="size-4" />
                </button>
              </div>
              <p className="text-sm text-ledger-text">
                {selecionada.rua ? `${selecionada.rua}${selecionada.numero ? `, ${selecionada.numero}` : ""}` : "Rua não cadastrada"}
                <br />
                <span className="text-ledger-muted">
                  {[selecionada.bairro, fmtCep(selecionada.cep) ? `CEP ${fmtCep(selecionada.cep)}` : null].filter(Boolean).join(" · ") || "Sem bairro/CEP"}
                </span>
              </p>
              <p className="text-xs text-ledger-muted">
                {selecionada.onde === "rua"
                  ? "Posição na rua do cadastro."
                  : selecionada.onde === "cep"
                    ? "Posição pelo CEP (rua não encontrada no mapa)."
                    : "Sem rua localizada ainda: aparece no centro da cidade."}
              </p>
              <Link to="/admin/cadastros/pessoas/$id" params={{ id: selecionada.party_id }} className="admin-btn text-xs">
                Abrir cadastro <ExternalLink aria-hidden className="size-3.5" />
              </Link>
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
                onKeyDown={(e) => {
                  if (e.key === "Enter" && visiveis[0]) escolher(visiveis[0].party_id);
                }}
                placeholder="Buscar por nome, código, CEP, rua ou bairro"
                aria-label="Buscar consultora por nome, código, CEP, rua ou bairro"
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
              {visiveis.slice(0, 600).map((c) => (
                <li key={c.party_id}>
                  <button
                    type="button"
                    onClick={() => escolher(c.party_id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-1 py-2 text-left text-sm hover:bg-surface-muted",
                      sel === c.party_id && "bg-surface-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block shrink-0 rounded-full",
                        c.status === "ativo" ? "mapa-legenda-ativa size-3" : "mapa-legenda-inativa size-2",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-ledger-text">{c.nome}</span>
                    <span className="max-w-[45%] truncate text-xs text-ledger-muted">{c.rua ?? c.bairro ?? ""}</span>
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
                        {v.ativas} ativas · {v.total} total
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-muted">
                      <div
                        className="mapa-legenda-ativa h-full rounded-full"
                        style={{ width: `${(v.total / (bairros[0]?.[1].total || 1)) * 100}%` }}
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
