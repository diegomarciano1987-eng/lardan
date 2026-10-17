import * as React from "react";
import nomeLardan from "@/assets/lardan-wordmark.png.asset.json";
import { CUIDADOS, GARANTIA_ANOS, MANUAL_CUIDADOS_URL, TROCA_DIAS } from "@/lib/consultora-regras";

/** Folha A4 imprimível (Salvar como PDF pelo navegador). */
export function FolhaA4({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted py-6 print:bg-background print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] justify-end gap-2 px-4 print:hidden">
        <button type="button" className="btn-app-principal" onClick={() => window.print()}>Salvar PDF / Imprimir</button>
      </div>
      <article className="mx-auto max-w-[210mm] bg-background p-[14mm] text-foreground shadow-lg print:shadow-none">
        <header className="mb-6 flex items-end justify-between border-b-2 border-primary pb-4">
          <img src={nomeLardan.url} alt="LARDAN" className="h-auto w-36" />
          <h1 className="text-right font-display text-2xl">{titulo}</h1>
        </header>
        {children}
      </article>
    </div>
  );
}

export function ModoDeUso() {
  return (
    <section className="break-inside-avoid">
      <h2 className="mb-2 text-lg font-semibold">Modo de uso — como não perder a garantia</h2>
      <ol className="grid gap-2 text-[0.92rem] leading-snug">
        {CUIDADOS.map((c, i) => <li key={c.titulo}><strong>{i + 1}. {c.titulo}.</strong> {c.texto}</li>)}
      </ol>
      <p className="mt-3 text-[0.9rem]">Garantia de {GARANTIA_ANOS} anos contra defeitos do banho, seguindo este modo de uso. Troca em até {TROCA_DIAS} dias a partir da compra. Manual completo: {MANUAL_CUIDADOS_URL}</p>
    </section>
  );
}
