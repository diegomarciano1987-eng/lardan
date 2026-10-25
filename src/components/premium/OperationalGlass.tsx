import { useEffect, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { isOperationalGlassPath } from "@/lib/operational-glass";
import backdrop from "@/assets/lardan-hero-vidro.jpg.asset.json";

/** Mounted by private experiences only; portals inherit tokens while mounted. */
export function OperationalGlass({ children, area }: { children: ReactNode; area: "admin" | "representante" | "pdv" }) {
  const { pathname } = useLocation();
  const active = isOperationalGlassPath(pathname);
  useEffect(() => {
    if (!active) return;
    document.body.classList.add("operational-glass-active");
    return () => { document.body.classList.remove("operational-glass-active"); };
  }, [active]);
  if (!active) return <>{children}</>;
  return (
    <div className="operational-glass" data-operational-area={area}>
      <img src={backdrop.url} alt="" aria-hidden="true" className="operational-glass-backdrop" />
      {children}
    </div>
  );
}