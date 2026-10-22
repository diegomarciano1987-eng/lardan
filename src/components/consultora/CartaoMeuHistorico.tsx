/**
 * Cartão "O que eu mais vendo" para o início da consultora: leitura do
 * histórico do SmallData dela, com linguagem simples. Escondido quando o cadastro
 * dela não está ligado a nenhuma consultora do histórico.
 */
import { useQuery } from "@tanstack/react-query";
import { meuHistorico } from "@/lib/historico-jflex";

function Barra({ nome, pct, detalhe }: { nome: string; pct: number; detalhe: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[1.02rem]">
        <span className="font-semibold">{nome}</span>
        <span className="tabular-nums text-muted-foreground">{detalhe}</span>
      </div>
      <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
    </div>
  );
}

export function CartaoMeuHistorico() {
  const q = useQuery({ queryKey: ["consultora", "meu-historico"], queryFn: meuHistorico });
  if (q.isLoading || q.isError) return null;
  const d = q.data;
  if (!d?.vinculada) return null;
  const r = d.resumo;
  const top = d.categorias?.slice(0, 4) ?? [];
  const maxPart = Math.max(...top.map((c) => c.participacao_vendas_pct ?? 0), 1);
  const produtos = (d.produtos_top ?? []).slice(0, 5);

  return (
    <section aria-labelledby="meu-hist" className="rounded-3xl border border-border bg-card p-6">
      <h2 id="meu-hist" className="mb-1 text-xl font-semibold">O que eu mais vendo</h2>
      <p className="mb-4 text-[0.98rem] text-muted-foreground">
        Sua história nas maletas anteriores. Use para escolher o que levar na próxima maleta.
      </p>
      <dl className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-2xl bg-muted/60 p-3">
          <dt className="text-[0.92rem] text-muted-foreground">Peças vendidas</dt>
          <dd className="font-numeric text-3xl font-semibold tabular-nums">{r?.pecas_vendidas ?? 0}</dd>
        </div>
        <div className="rounded-2xl bg-muted/60 p-3">
          <dt className="text-[0.92rem] text-muted-foreground">Giro</dt>
          <dd className="font-numeric text-3xl font-semibold tabular-nums">{r?.giro_pct != null ? `${r.giro_pct}%` : "—"}</dd>
        </div>
        <div className="rounded-2xl bg-muted/60 p-3">
          <dt className="text-[0.92rem] text-muted-foreground">Maletas</dt>
          <dd className="font-numeric text-3xl font-semibold tabular-nums">{r?.maletas ?? 0}</dd>
        </div>
      </dl>
      {top.length > 0 && (
        <div className="mt-5 space-y-3">
          <p className="text-[1.02rem] font-semibold">Suas categorias favoritas</p>
          {top.map((c) => (
            <Barra key={c.categoria} nome={c.categoria.toLowerCase()} pct={(c.participacao_vendas_pct ?? 0) / maxPart * 100}
              detalhe={`${c.participacao_vendas_pct ?? 0}% das suas vendas`} />
          ))}
        </div>
      )}
      {produtos.length > 0 && (
        <div className="mt-5 space-y-2">
          <p className="text-[1.02rem] font-semibold">As peças que mais saem</p>
          <ol className="space-y-1 text-[1.02rem]">
            {produtos.map((p, i) => (
              <li key={p.produto} className="flex items-baseline justify-between gap-3">
                <span><span className="mr-2 font-semibold text-primary">{i + 1}.</span>{p.nome ?? "Peça"}</span>
                <span className="tabular-nums text-muted-foreground">{p.quantidade} vendidas</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
