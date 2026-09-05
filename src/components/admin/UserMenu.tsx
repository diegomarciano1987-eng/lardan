import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, LogOut, KeyRound, UserRound, Camera, ShieldCheck } from "lucide-react";
import { fetchMyProfile, signedAvatarUrl } from "@/lib/profile";
import type { AppRole } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";

/** Menu da conta: identidade, foto, senha e dados do usuário. */
export function UserMenu({
  email,
  roles,
  onSignOut,
}: {
  email: string | undefined;
  roles: AppRole[];
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const perfil = useQuery({ queryKey: ["my-profile"], queryFn: fetchMyProfile });
  const foto = useQuery({
    queryKey: ["my-avatar", perfil.data?.avatar_url],
    queryFn: () => signedAvatarUrl(perfil.data?.avatar_url ?? null),
    enabled: Boolean(perfil.data?.avatar_url),
  });

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  const nome =
    perfil.data?.display_name || perfil.data?.full_name || email || "Conta";
  const initials = (perfil.data?.full_name || email || "?").slice(0, 2).toUpperCase();
  const papeis = roles.length ? roles.map((r) => ROLE_LABEL[r]).join(" · ") : "Sem papel";

  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ledger-text transition-colors hover:bg-surface-muted";

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-[10px] border border-line-soft px-2 py-1.5 text-left transition-colors hover:bg-surface-muted"
      >
        <Avatar url={foto.data ?? null} initials={initials} className="size-7 text-[0.625rem]" />
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-36 truncate text-xs text-ledger-text">{nome}</span>
          <span className="block max-w-36 truncate text-[0.625rem] text-ledger-muted">
            {papeis}
          </span>
        </span>
        <ChevronDown aria-hidden className="size-3.5 text-ledger-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] w-72 rounded-xl border border-line-soft bg-surface p-2 shadow-xl"
        >
          <div className="flex items-center gap-3 rounded-lg bg-surface-muted px-3 py-3">
            <Avatar url={foto.data ?? null} initials={initials} className="size-10 text-xs" />
            <div className="min-w-0">
              <p className="truncate text-sm text-ledger-text">{nome}</p>
              <p className="truncate text-[0.6875rem] text-ledger-muted">{email}</p>
              <p className="mt-0.5 truncate text-[0.6875rem] text-bronze">{papeis}</p>
            </div>
          </div>

          <div className="mt-2 space-y-0.5">
            <Link to="/admin/perfil" className={item} onClick={() => setOpen(false)}>
              <UserRound aria-hidden className="size-4 text-ledger-muted" /> Meus dados
            </Link>
            <Link
              to="/admin/perfil"
              hash="foto"
              className={item}
              onClick={() => setOpen(false)}
            >
              <Camera aria-hidden className="size-4 text-ledger-muted" /> Trocar foto
            </Link>
            <Link
              to="/admin/perfil"
              hash="senha"
              className={item}
              onClick={() => setOpen(false)}
            >
              <KeyRound aria-hidden className="size-4 text-ledger-muted" /> Trocar senha
            </Link>
            <Link
              to="/admin/perfil"
              hash="acesso"
              className={item}
              onClick={() => setOpen(false)}
            >
              <ShieldCheck aria-hidden className="size-4 text-ledger-muted" /> Acesso e papéis
            </Link>
          </div>

          <div className="mt-2 border-t border-line-soft pt-2">
            <button type="button" onClick={onSignOut} className={item}>
              <LogOut aria-hidden className="size-4 text-ledger-muted" /> Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Avatar({
  url,
  initials,
  className = "size-10 text-xs",
}: {
  url: string | null;
  initials: string;
  className?: string;
}) {
  if (url) {
    return (
      <img
        src={url}
        alt="Foto do perfil"
        className={`shrink-0 rounded-lg object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-lg bg-ink text-warm-ivory ${className}`}
    >
      {initials}
    </span>
  );
}
