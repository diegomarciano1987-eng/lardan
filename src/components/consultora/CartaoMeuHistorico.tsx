/**
 * Cartão "O que eu mais vendo" para o início da consultora: leitura do
 * histórico do SmallData dela, com linguagem simples. Escondido quando o cadastro
 * dela não está ligado a nenhuma consultora do histórico.
 */
import { useQuery } from "@tanstack/react-query";
import { meuHistorico } from "@/lib/historico-jflex";
import { comissaoPorRemessa, faixasComissao } from "@/lib/comissao-maletas";
import { brl } from "@/lib/maletas";
import { supabase } from "@/integrations/supabase/client";
import { chaveCategoria, textoBanhos, useBanhos } from "@/components/admin/historico/BanhosCategoria";

function Barra({ nome, pct, detalhe, banho }: { nome: string; pct: number; detalhe: string; banho?: string | null }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[1.02rem]">
        <span className="font-semibold">{nome}</span>
        <span className="tabular-nums text-muted-foreground">{detalhe}</span>
      </div>
      <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
      {banho && <span className="mt-1 block text-[0.95rem] text-muted-foreground">{banho}</span>}
    </div>
  );
}

function MinhasComissoes({ maletas }: { maletas: { remessa: number; kit: number; tipo: string; fechamento: string | null; valor_vendido_cents: number | null }[] }) {
  const f = useQuery({ queryKey: ["consultora", "comissao-faixas"], queryFn: faixasComissao });
  const faixas = f.data ?? [];
  if (faixas.length === 0) return null;
  const linhas = comissaoPorRemessa(maletas, faixas).filter((g) => g.comissao_cents != null).slice(0, 6);
  if (linhas.length === 0) return null;
  return (
    <div className="mt-5 space-y-2">
      <p className="text-[1.02rem] font-semibold">Minha comissão nas últimas remessas</p>
      <ul className="space-y-1 text-[1.02rem]">
        {linhas.map((g) => (
          <li key={g.remessa} className="flex items-baseline justify-between gap-3">
            <span>Remessa {g.remessa}{g.kits.length > 1 ? ` (${g.kits.length} kits somados)` : ""} · vendeu {brl(g.vendido_cents ?? 0)}{g.faixa ? ` (${g.faixa.percentual.toLocaleString("pt-BR")}%)` : ""}</span>
            <strong className="tabular-nums">{brl(g.comissao_cents ?? 0)}</strong>
          </li>
        ))}
      </ul>
      <p className="text-[0.92rem] text-muted-foreground">Estimativa pela tabela de comissão atual da LARDAN.</p>
    </div>
  );
}

export function CartaoMeuHistorico() {
  const q = useQuery({ queryKey: ["consultora", "meu-historico"], queryFn: meuHistorico });
  const eu = useQuery({ queryKey: ["consultora", "my-party-id"], staleTime: Infinity, queryFn: async () => {
    const { data, error } = await supabase.rpc("my_party_id" as never);
    if (error) throw error;
    return (data as unknown as string | null) ?? null;
  } });
  const banhos = useBanhos(eu.data);
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
              detalhe={`${c.participacao_vendas_pct ?? 0}% das suas vendas`} banho={textoBanhos(banhos.data?.porCategoria.get(chaveCategoria(c.categoria)))} />
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
      <MinhasComissoes maletas={(d.maletas ?? []) as never} />
    </section>
  );
}
