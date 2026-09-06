import type { ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { AlertTriangle, Info, Lock, Clock3, CircleDot, ArrowLeft } from "lucide-react";
import { STATE_LABEL, type ModuleState } from "@/lib/admin-modules";
import { cn } from "@/lib/utils";

/** Botão Voltar — retorna para a última tela visitada. */
export function BackButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.history.back()}
      aria-label="Voltar para a tela anterior"
      title="Voltar"
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-cream-2 text-ledger-text transition hover:border-bronze hover:text-bronze focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze",
        className,
      )}
    >
      <ArrowLeft aria-hidden className="size-4.5" />
    </button>
  );
}

/** Selo de disponibilidade do módulo. Estado nunca depende só de cor. */
export function ModuleAvailabilityBadge({
  state,
  className,
}: {
  state: ModuleState;
  className?: string;
}) {
  const map: Record<ModuleState, { cls: string; icon: typeof Lock }> = {
    ativo: { cls: "border-champagne text-bronze", icon: CircleDot },
    em_construcao: { cls: "border-line text-warning", icon: Clock3 },
    em_breve: { cls: "border-line text-ledger-muted", icon: Lock },
  };
  const { cls, icon: Icon } = map[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border bg-surface px-2.5 py-1 text-[0.7rem] font-semibold tracking-[0.1em] uppercase shadow-sm",
        cls,
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {STATE_LABEL[state]}
    </span>
  );
}

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const map: Record<StatusTone, string> = {
    success: "border-success text-success",
    warning: "border-warning text-warning",
    danger: "border-danger text-danger",
    info: "border-info text-info",
    neutral: "border-line text-ledger-muted",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.1em] shadow-sm",
        map[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("ledger-panel flex min-w-0 flex-col", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
          {title ? <h2 className="ledger-eyebrow">{title}</h2> : <span />}
          {action}
        </header>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-7">
      <div className="flex min-w-0 items-start gap-4">
        <BackButton className="mt-1" />
        <div className="min-w-0">
          <p className="ledger-eyebrow">{eyebrow}</p>
          <h1 className="mt-2 text-[2.375rem] leading-[1.08] font-semibold text-ledger-text md:text-[2.875rem]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-[0.9375rem] font-medium text-ledger-muted">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 px-5 py-10">
      <p className="inline-flex items-center gap-2 text-[0.9375rem] font-semibold text-ledger-text">
        <Info aria-hidden className="size-4 text-bronze" />
        {title}
      </p>
      <p className="max-w-xl text-sm font-medium leading-relaxed text-ledger-muted">{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 px-5 py-8">
      <p className="inline-flex items-center gap-2 text-sm text-danger">
        <AlertTriangle aria-hidden className="size-4" />
        {message}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="admin-btn">
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-lg bg-surface-muted", className)} aria-hidden />
  );
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatBRLFromCents = (cents: number) => brl.format(cents / 100);
export const formatInt = (n: number) => new Intl.NumberFormat("pt-BR").format(n);
export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
