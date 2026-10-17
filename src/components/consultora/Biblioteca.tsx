import { ArtesSemana } from "@/components/consultora/ArtesSemana";
import { Link } from "@tanstack/react-router";
import { BookOpen, FileDown, MessageCircle, ShieldCheck } from "lucide-react";
import { CUIDADOS, GARANTIA_ANOS, MANUAL_CUIDADOS_URL, TROCA_DIAS } from "@/lib/consultora-regras";

export function Biblioteca() {
  const whats = `https://wa.me/?text=${encodeURIComponent(`Olá! Aqui está o manual de cuidados das suas semijoias LARDAN. Seguindo essas dicas você mantém a garantia de ${GARANTIA_ANOS} anos: ${MANUAL_CUIDADOS_URL}`)}`;
  return (
    <div className="space-y-5">
      <ArtesSemana />
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <BookOpen className="mt-1 size-8 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">Modo de uso e cuidados</h2>
            <p className="mt-1 text-[1.02rem] text-muted-foreground">Como usar as semijoias para não perder a garantia de {GARANTIA_ANOS} anos.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Link to="/consultora-manual" target="_blank" className="btn-app-principal w-full"><FileDown className="size-5" aria-hidden /> Abrir PDF do manual</Link>
          <a href={whats} target="_blank" rel="noreferrer" className="admin-btn min-h-13 w-full justify-center text-base"><MessageCircle className="size-5" aria-hidden /> Enviar para cliente</a>
        </div>
        <ol className="mt-6 grid gap-3 md:grid-cols-2">
          {CUIDADOS.map((c, i) => (
            <li key={c.titulo} className="rounded-xl border border-border bg-background p-4">
              <p className="font-semibold">{i + 1}. {c.titulo}</p>
              <p className="mt-1 text-[0.98rem] leading-relaxed text-muted-foreground">{c.texto}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <ShieldCheck className="mt-1 size-8 shrink-0 text-primary" aria-hidden />
          <div>
            <h2 className="text-xl font-semibold">Garantia e troca</h2>
            <p className="mt-2 text-[1.02rem] leading-relaxed">Garantia de <strong>{GARANTIA_ANOS} anos</strong> a partir da data da compra, seguindo o modo de uso. Troca em até <strong>{TROCA_DIAS} dias</strong>. O comprovante de cada venda (em Pedidos) serve como certificado de garantia da cliente.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
