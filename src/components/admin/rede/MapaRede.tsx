import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  caminho,
  centro,
  corDaFaixa,
  escalaQuantil,
  faixaDe,
  projetar,
  type Malha,
} from "@/lib/rede/geo";
import type { PontoRede } from "@/lib/rede/consultas";

export interface ValorTerritorio {
  chave: string;
  nome: string;
  total: number;
  ativas: number;
}

interface Props {
  malha: Malha;
  valores: ValorTerritorio[];
  /** Converte o `codarea` da malha na chave usada nos valores (UF ou código do município). */
  chaveDaFeicao: (codarea: string) => string;
  selecionado?: string | null;
  onSelecionar: (chave: string) => void;
  pontos?: PontoRede[];
  camada: "quantidade" | "ativas" | "concentracao";
  totalRede: number;
}

const LARGURA = 720;

export function MapaRede({
  malha,
  valores,
  chaveDaFeicao,
  selecionado,
  onSelecionar,
  pontos = [],
  camada,
  totalRede,
}: Props) {
  const [focado, setFocado] = useState<string | null>(null);

  const projecao = useMemo(() => projetar(malha, LARGURA), [malha]);
  const porChave = useMemo(() => new Map(valores.map((v) => [v.chave, v])), [valores]);
  const metrica = (v?: ValorTerritorio) => (!v ? 0 : camada === "ativas" ? v.ativas : v.total);
  const cortes = useMemo(
    () => escalaQuantil(valores.map((v) => metrica(v))),
    [valores, camada],
  );

  const maiorPonto = pontos.reduce((m, p) => Math.max(m, p.total), 0) || 1;
  const destaque = focado ?? selecionado ?? null;
  const info = destaque ? porChave.get(destaque) : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${projecao.largura} ${projecao.altura}`}
        role="group"
        aria-label="Mapa da rede Lardan por território"
        className="w-full"
      >
        {malha.features.map((f) => {
          const chave = chaveDaFeicao(f.properties.codarea);
          const valor = porChave.get(chave);
          const qtd = metrica(valor);
          const ativo = selecionado === chave;
          return (
            <path
              key={f.properties.codarea}
              d={caminho(f.geometry, projecao)}
              fill={camada === "concentracao" ? "color-mix(in oklab, var(--muted) 35%, white)" : corDaFaixa(faixaDe(qtd, cortes))}
              stroke={ativo ? "var(--rose)" : "color-mix(in oklab, var(--foreground) 22%, transparent)"}
              strokeWidth={ativo ? 1.6 : 0.5}
              tabIndex={0}
              role="button"
              aria-label={`${valor?.nome ?? chave}: ${qtd} consultoras`}
              className="cursor-pointer outline-none transition-[stroke-width] focus-visible:stroke-[2px]"
              onMouseEnter={() => setFocado(chave)}
              onMouseLeave={() => setFocado(null)}
              onFocus={() => setFocado(chave)}
              onBlur={() => setFocado(null)}
              onClick={() => onSelecionar(chave)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelecionar(chave);
                }
              }}
            />
          );
        })}

        {/* Rótulo discreto dos territórios com rede */}
        {camada !== "concentracao" &&
          malha.features.map((f) => {
            const chave = chaveDaFeicao(f.properties.codarea);
            const valor = porChave.get(chave);
            if (!valor || metrica(valor) === 0) return null;
            const [x, y] = centro(f.geometry, projecao);
            return (
              <text
                key={`r-${f.properties.codarea}`}
                x={x}
                y={y}
                textAnchor="middle"
                className="pointer-events-none fill-ledger-text text-[9px] font-semibold [font-variant-numeric:tabular-nums]"
              >
                {metrica(valor)}
              </text>
            );
          })}

        {/* Camada de concentração: agrupamentos, nunca residência exata */}
        {camada === "concentracao" &&
          pontos.map((p, i) => {
            const [x, y] = projecao.ponto(p.lng, p.lat);
            const r = 4 + (p.total / maiorPonto) * 14;
            return (
              <g key={`p-${i}`}>
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill="color-mix(in oklab, var(--rose) 45%, transparent)"
                  stroke="var(--rose)"
                  strokeWidth={0.8}
                  strokeDasharray={p.aproximado ? "2 2" : undefined}
                />
                <text
                  x={x}
                  y={y + 3}
                  textAnchor="middle"
                  className="pointer-events-none fill-white text-[9px] font-semibold [font-variant-numeric:tabular-nums]"
                >
                  {p.total}
                </text>
              </g>
            );
          })}
      </svg>

      {/* Leitura textual — o mapa nunca é a única forma de ler o dado */}
      <div
        aria-live="polite"
        className={cn(
          "pointer-events-none absolute left-3 top-3 rounded-md border border-line-soft bg-surface px-3 py-2 text-xs shadow-sm",
          !info && "opacity-0",
        )}
      >
        {info ? (
          <>
            <p className="font-semibold text-ledger-text">{info.nome}</p>
            <p className="text-ledger-muted [font-variant-numeric:tabular-nums]">
              {info.total} no total · {info.ativas} ativas ·{" "}
              {totalRede ? ((info.total / totalRede) * 100).toFixed(1) : "0.0"}% da rede
            </p>
          </>
        ) : (
          <span>—</span>
        )}
      </div>

      <Legenda cortes={cortes} camada={camada} />
    </div>
  );
}

function Legenda({ cortes, camada }: { cortes: number[]; camada: string }) {
  if (camada === "concentracao") {
    return (
      <p className="mt-3 text-xs text-ledger-muted">
        Cada círculo agrupa consultoras próximas. Contorno tracejado indica localização aproximada
        pelo estado. Endereço residencial nunca é exibido.
      </p>
    );
  }
  const faixas = [0, ...cortes];
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ledger-muted">
      <li className="flex items-center gap-1.5">
        <span
          className="inline-block size-3 rounded-[2px] border border-line-soft"
          style={{ background: corDaFaixa(0) }}
        />
        Sem cobertura
      </li>
      {faixas.map((corte, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-[2px] border border-line-soft"
            style={{ background: corDaFaixa(i + 1) }}
          />
          <span className="[font-variant-numeric:tabular-nums]">
            {i === 0 ? "1" : `> ${corte}`}
            {i === faixas.length - 1 ? "+" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
