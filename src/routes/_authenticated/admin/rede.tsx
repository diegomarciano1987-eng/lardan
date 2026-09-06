import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MapPinned, RefreshCw } from "lucide-react";
import { PageHeader, Panel, EmptyState, ErrorState, formatInt } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { MapaRede, type ValorTerritorio } from "@/components/admin/rede/MapaRede";
import { PainelTerritorio } from "@/components/admin/rede/PainelTerritorio";
import { CoberturaRede } from "@/components/admin/rede/CoberturaRede";
import { OPCOES_UF } from "@/lib/br/ufs";
import { UF_CODIGO_IBGE, CODIGO_IBGE_UF, type Malha } from "@/lib/rede/geo";
import {
  FILTROS_REDE_VAZIOS,
  contarFiltrosAtivos,
  municipiosDaUf,
  pontosRede,
  territorioRede,
  visaoGeralRede,
  type FiltrosRede,
} from "@/lib/rede/consultas";
import { obterMalha, localizarEnderecos, situacaoDaLocalizacao } from "@/lib/rede/rede.functions";
import { useCapabilities, can } from "@/lib/capabilities";

export const Route = createFileRoute("/_authenticated/admin/rede")({
  component: RedePage,
  head: () => ({
    meta: [
      { title: "Inteligência da Rede — LARDAN Cloud" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type Camada = "quantidade" | "ativas" | "concentracao";
type Aba = "mapa" | "cobertura";

function RedePage() {
  const caps = useCapabilities();
  const podeVer = can(caps, "partners.view");
  const podeGerir = can(caps, "partners.manage");

  const [filtros, setFiltros] = useState<FiltrosRede>(FILTROS_REDE_VAZIOS);
  const [camada, setCamada] = useState<Camada>("quantidade");
  const [aba, setAba] = useState<Aba>("mapa");
  const [uf, setUf] = useState<string | null>(null);
  const [ibge, setIbge] = useState<string | null>(null);

  const buscarMalha = useServerFn(obterMalha);
  const rodarLocalizacao = useServerFn(localizarEnderecos);
  const verSituacao = useServerFn(situacaoDaLocalizacao);

  const geral = useQuery({
    queryKey: ["rede-geral", filtros],
    queryFn: () => visaoGeralRede(filtros),
    enabled: podeVer,
  });

  const malha = useQuery({
    queryKey: ["rede-malha", uf],
    queryFn: async () => {
      const r = (await buscarMalha({
        data: uf
          ? { nivel: "estado" as const, codigoUf: UF_CODIGO_IBGE[uf]! }
          : { nivel: "brasil" as const },
      })) as unknown as { malha: Malha };
      return r.malha;
    },
    enabled: podeVer,
    staleTime: 1000 * 60 * 60,
  });

  const municipios = useQuery({
    queryKey: ["rede-municipios", uf, filtros],
    queryFn: () => municipiosDaUf(uf!, filtros),
    enabled: podeVer && !!uf,
  });

  const pontos = useQuery({
    queryKey: ["rede-pontos", filtros, uf],
    queryFn: () => pontosRede(uf ? { ...filtros, uf } : filtros),
    enabled: podeVer && camada === "concentracao",
  });

  const territorio = useQuery({
    queryKey: ["rede-territorio", uf, ibge, filtros],
    queryFn: () => territorioRede(uf, ibge, filtros),
    enabled: podeVer,
  });

  const situacao = useQuery({
    queryKey: ["rede-situacao-localizacao"],
    queryFn: () => verSituacao({ data: undefined }),
    enabled: podeVer,
  });

  const valores = useMemo<ValorTerritorio[]>(() => {
    if (!uf) {
      return (geral.data?.estados ?? []).map((e) => ({
        chave: e.uf,
        nome: e.nome,
        total: e.total,
        ativas: e.ativas,
      }));
    }
    return (municipios.data ?? []).map((m) => ({
      chave: m.codigo_ibge,
      nome: m.municipio,
      total: m.total,
      ativas: m.ativas,
    }));
  }, [uf, geral.data, municipios.data]);

  if (!podeVer) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Rede"
          title="Inteligência da Rede"
          description="Mapa territorial das consultoras."
        />
        <EmptyState
          title="Acesso restrito"
          description="Seu papel não tem permissão para visualizar a rede."
        />
      </div>
    );
  }

  const ind = geral.data?.indicadores;
  const titulo = ibge
    ? (valores.find((v) => v.chave === ibge)?.nome ?? "Município")
    : uf
      ? (geral.data?.estados.find((e) => e.uf === uf)?.nome ?? uf)
      : "Brasil";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rede"
        title="Inteligência da Rede"
        description="Onde a Lardan já está, onde está concentrada e onde ainda não chegou. Somente dados reais de cadastro."
        actions={
          podeGerir ? (
            <button
              type="button"
              className="admin-btn-primary"
              onClick={async () => {
                try {
                  const r = (await rodarLocalizacao({ data: { limite: 40 } })) as {
                    processados: number;
                    localizados: number;
                    falhas: number;
                  };
                  toast.success(
                    `${r.localizados} localizadas · ${r.falhas} sem coordenada · ${r.processados} analisadas.`,
                  );
                  void situacao.refetch();
                  void geral.refetch();
                } catch {
                  toast.error("Não foi possível processar as localizações agora.");
                }
              }}
            >
              <RefreshCw aria-hidden className="size-4" /> Atualizar localizações
            </button>
          ) : undefined
        }
      />

      {geral.error ? (
        <ErrorState message="Não foi possível ler a rede." onRetry={() => void geral.refetch()} />
      ) : null}

      {geral.data?.escopo_restrito ? (
        <p className="rounded-md border border-line-soft bg-surface px-4 py-3 text-sm text-ledger-muted">
          Você está vendo apenas a sua carteira. Números gerais da rede são restritos ao seu escopo.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Consultoras cadastradas" valor={ind?.total} />
        <Indicador rotulo="Ativas" valor={ind?.ativas} />
        <Indicador rotulo="Estados alcançados" valor={ind?.estados} />
        <Indicador rotulo="Municípios alcançados" valor={ind?.municipios} />
      </div>

      <Panel title="Filtros">
        <div className="grid gap-4 md:grid-cols-4">
          <Campo rotulo="Estado">
            <SmartSelect
              options={[{ value: "", label: "Todos os estados" }, ...OPCOES_UF]}
              value={uf ?? ""}
              searchThreshold={99}
              onChange={(v) => {
                setUf(v || null);
                setIbge(null);
              }}
              placeholder="Todos os estados"
            />
          </Campo>
          <Campo rotulo="Situação">
            <SmartSelect
              options={[
                { value: "todas", label: "Todas" },
                { value: "ativa", label: "Somente ativas" },
                { value: "inativa", label: "Inativas ou bloqueadas" },
              ]}
              value={filtros.situacao ?? "todas"}
              searchThreshold={99}
              onChange={(v) => setFiltros((f) => ({ ...f, situacao: v as FiltrosRede["situacao"] }))}
            />
          </Campo>
          <Campo rotulo="Camada do mapa">
            <SmartSelect
              options={[
                { value: "quantidade", label: "Quantidade de consultoras" },
                { value: "ativas", label: "Somente ativas" },
                { value: "concentracao", label: "Concentração aproximada" },
              ]}
              value={camada}
              searchThreshold={99}
              onChange={(v) => setCamada(v as Camada)}
            />
          </Campo>
          <div className="flex items-end">
            <button
              type="button"
              className="admin-btn"
              onClick={() => {
                setFiltros(FILTROS_REDE_VAZIOS);
                setUf(null);
                setIbge(null);
              }}
            >
              Limpar filtros ({contarFiltrosAtivos(filtros) + (uf ? 1 : 0)})
            </button>
          </div>
        </div>
      </Panel>

      <nav className="flex gap-2" aria-label="Visões da rede">
        {(["mapa", "cobertura"] as Aba[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAba(a)}
            className={
              aba === a
                ? "admin-btn-primary text-warm-ivory"
                : "admin-btn"
            }
          >
            {a === "mapa" ? "Mapa territorial" : "Cobertura"}
          </button>
        ))}
      </nav>

      {aba === "mapa" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel title={uf ? `Mapa — ${titulo}` : "Mapa do Brasil"}>
            {malha.error ? (
              <ErrorState
                message="Não foi possível carregar o mapa."
                onRetry={() => void malha.refetch()}
              />
            ) : malha.isLoading || !malha.data ? (
              <p className="text-sm text-ledger-muted">Desenhando o território…</p>
            ) : (
              <MapaRede
                malha={malha.data}
                valores={valores}
                chaveDaFeicao={(cod) => (uf ? cod : (CODIGO_IBGE_UF[cod] ?? cod))}
                selecionado={ibge ?? uf}
                onSelecionar={(chave) => {
                  if (uf) setIbge((atual) => (atual === chave ? null : chave));
                  else setUf(chave);
                }}
                pontos={pontos.data ?? []}
                camada={camada}
                totalRede={ind?.total ?? 0}
              />
            )}
          </Panel>

          <Panel title="Território selecionado">
            <PainelTerritorio
              titulo={titulo}
              territorio={territorio.data}
              carregando={territorio.isLoading}
              onVoltar={
                uf
                  ? () => {
                      if (ibge) setIbge(null);
                      else setUf(null);
                    }
                  : undefined
              }
              onAbrirCobertura={() => setAba("cobertura")}
            />
          </Panel>

          <Panel title="Qualidade das localizações" className="lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-4">
              <Indicador rotulo="Endereços completos" valor={ind?.localizadas} />
              <Indicador rotulo="Endereços incompletos" valor={ind?.incompletas} />
              <Indicador rotulo="Sem endereço" valor={ind?.sem_endereco} />
              <Indicador
                rotulo="Aguardando localização"
                valor={(situacao.data as { pendentes?: number } | undefined)?.pendentes ?? ind?.aguardando}
              />
            </div>
            <p className="mt-4 flex items-center gap-2 text-xs text-ledger-muted">
              <MapPinned aria-hidden className="size-3.5" />
              O mapa mostra apenas agrupamentos por território. Endereço residencial de consultora
              nunca é exibido.
            </p>
          </Panel>
        </div>
      ) : (
        <CoberturaRede filtros={uf ? { ...filtros, uf } : filtros} />
      )}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs uppercase tracking-[0.08em] text-ledger-muted">
        {rotulo}
      </span>
      {children}
    </label>
  );
}

function Indicador({ rotulo, valor }: { rotulo: string; valor?: number | undefined }) {
  return (
    <div className="ledger-panel px-5 py-4">
      <p className="text-xs uppercase tracking-[0.08em] text-ledger-muted">{rotulo}</p>
      <p className="mt-1.5 text-3xl font-semibold text-ledger-text [font-variant-numeric:tabular-nums]">
        {valor === undefined ? "—" : formatInt(valor)}
      </p>
    </div>
  );
}
