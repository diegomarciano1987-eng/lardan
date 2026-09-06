import { formatDateTime, formatInt } from "@/components/admin/ui";
import type { Territorio } from "@/lib/rede/consultas";

interface Props {
  titulo: string;
  territorio: Territorio | undefined;
  carregando: boolean;
  onVoltar?: (() => void) | undefined;
  onAbrirCobertura: () => void;
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-soft py-2 last:border-0">
      <dt className="text-sm text-ledger-muted">{rotulo}</dt>
      <dd className="text-sm font-semibold text-ledger-text [font-variant-numeric:tabular-nums]">
        {typeof valor === "number" ? formatInt(valor) : valor}
      </dd>
    </div>
  );
}

export function PainelTerritorio({
  titulo,
  territorio,
  carregando,
  onVoltar,
  onAbrirCobertura,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-ledger-text">{titulo}</h3>
        {onVoltar && (
          <button type="button" className="admin-btn" onClick={onVoltar}>
            Voltar ao Brasil
          </button>
        )}
      </div>

      {carregando || !territorio ? (
        <p className="text-sm text-ledger-muted">Lendo o território…</p>
      ) : territorio.total === 0 ? (
        <p className="text-sm text-ledger-muted">
          Nenhuma consultora cadastrada neste território. Região sem cobertura cadastrada.
        </p>
      ) : (
        <>
          <dl>
            <Linha rotulo="Consultoras" valor={territorio.total} />
            <Linha rotulo="Ativas" valor={territorio.ativas} />
            <Linha rotulo="Inativas ou bloqueadas" valor={territorio.inativas} />
            <Linha rotulo="Participação na rede" valor={`${territorio.percentual_rede}%`} />
            <Linha rotulo="Municípios alcançados" valor={territorio.municipios} />
            <Linha rotulo="Representantes presentes" valor={territorio.representantes} />
            <Linha rotulo="Carteiras presentes" valor={territorio.carteiras} />
            <Linha rotulo="Endereços completos" valor={territorio.enderecos_completos} />
            <Linha rotulo="Endereços incompletos" valor={territorio.enderecos_incompletos} />
            <Linha rotulo="Sem endereço" valor={territorio.sem_endereco} />
            <Linha rotulo="Ainda não localizadas" valor={territorio.nao_localizadas} />
          </dl>

          {territorio.ultimas_entradas.length > 0 && (
            <div>
              <p className="ledger-eyebrow mb-2">Últimas entradas</p>
              <ul className="space-y-1.5">
                {territorio.ultimas_entradas.map((e, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-ledger-text">{e.nome ?? "—"}</span>
                    <span className="shrink-0 text-xs text-ledger-muted">
                      {formatDateTime(e.entrou_em)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button type="button" className="admin-btn w-full" onClick={onAbrirCobertura}>
            Abrir cobertura
          </button>
        </>
      )}
    </div>
  );
}
