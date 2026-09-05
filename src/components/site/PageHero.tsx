import type { ReactNode } from "react";

export function PageHero({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className="mx-auto max-w-4xl px-6 pb-10 pt-36 text-center md:pt-44">
      <p className="brand-eyebrow mb-4">{eyebrow}</p>
      <h1 className="text-4xl leading-tight text-foreground md:text-6xl">{title}</h1>
      <div className="rose-rule mx-auto mt-8 w-20" />
      {children && (
        <div className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
          {children}
        </div>
      )}
    </section>
  );
}

export function PendingNote({ text }: { text: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 pb-24">
      <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        {text}
      </p>
    </div>
  );
}
