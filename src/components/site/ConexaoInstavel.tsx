import { useEffect } from "react";

/** Mostrada só quando a internet falha antes da primeira leitura de permissões. Nunca desloga. */
export function ConexaoInstavel({ onTentar }: { onTentar: () => void }) {
  useEffect(() => {
    const t = window.setInterval(onTentar, 5000);
    return () => window.clearInterval(t);
  }, [onTentar]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md text-center" role="status">
        <p className="brand-eyebrow mb-4">Sistema Lardan</p>
        <h1 className="font-display text-3xl text-foreground">Conexão instável</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          A internet oscilou. Você continua conectada; estamos tentando de novo sozinhos.
        </p>
        <button
          type="button"
          onClick={onTentar}
          className="mt-8 rounded-full bg-primary px-8 py-3 text-[0.75rem] tracking-[0.22em] uppercase text-primary-foreground hover:opacity-90"
        >
          Tentar agora
        </button>
      </div>
    </main>
  );
}
