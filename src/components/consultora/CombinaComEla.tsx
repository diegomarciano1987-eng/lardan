import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { FotoPeca } from "@/components/FotoPeca";
import { brl } from "@/lib/maletas";
import { buscarPecas, linkWhats, type Cliente } from "@/lib/consultora";

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const raiz = (w: string) => w.replace(/(oes|aes|es|s)$/, "");

/** Peças disponíveis na maleta que combinam com o que a cliente gosta (pelas preferências anotadas). */
export function CombinaComEla({ cl }: { cl: Cliente }) {
  const pecas = useQuery({ queryKey: ["consultora", "pecas", "opcoes"], queryFn: () => buscarPecas() });
  const palavras = Array.from(new Set(norm(cl.preferencias ?? "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4).map(raiz)));
  if (!palavras.length || !pecas.data?.length) return null;
  const achadas = pecas.data.filter((p) => p.disponivel > 0 && palavras.some((w) => norm(`${p.produto} ${p.categoria ?? ""} ${p.banho ?? ""} ${p.variante ?? ""}`).includes(w))).slice(0, 6);
  if (!achadas.length) return null;
  const texto = `Oi, ${cl.nome.split(" ")[0]}! Separei peças que combinam com você:\n${achadas.map((p) => `• ${p.produto} — ${brl(p.preco_cents)}`).join("\n")}\nQuer ver?`;
  const w = linkWhats(cl.telefone, texto);
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">Combina com ela, na sua maleta</h2>
      <p className="text-[0.95rem] text-muted-foreground">Pelo que você anotou em "Do que ela gosta".</p>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {achadas.map((p) => (
          <li key={`${p.cycle_id}:${p.variant_id}`} className="min-w-0">
            <FotoPeca mediaId={p.media_id} variantId={p.variant_id} className="aspect-square w-full rounded-xl" />
            <p className="mt-1 truncate text-[0.98rem] font-medium">{p.produto}</p>
            <p className="num text-[0.95rem]">{brl(p.preco_cents)}</p>
          </li>
        ))}
      </ul>
      {w && <a href={w} target="_blank" rel="noreferrer" className="btn-app-principal mt-4 w-full"><MessageCircle className="size-5" aria-hidden /> Enviar sugestões no WhatsApp</a>}
    </section>
  );
}
