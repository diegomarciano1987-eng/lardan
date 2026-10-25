import { useEffect, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { isOperationalGlassPath } from "@/lib/operational-glass";
import { useOperationalTheme } from "@/lib/operational-theme";

/** Mounted by private experiences only; portals inherit tokens while mounted. */
export function OperationalGlass({ children, area }: { children: ReactNode; area: "admin" | "representante" | "pdv" }) {
  const { pathname } = useLocation();
  const active = isOperationalGlassPath(pathname);
  const [theme] = useOperationalTheme();
  const light = theme === "light";
  useEffect(() => {
    if (!active) return;
    document.body.classList.add("operational-glass-active");
    document.body.classList.toggle("operational-glass-light-active", light);
    return () => {
      document.body.classList.remove("operational-glass-active");
      document.body.classList.remove("operational-glass-light-active");
    };
  }, [active, light]);
  if (!active) return <>{children}</>;
  return (
    <div className={light ? "operational-glass operational-glass-light" : "operational-glass"} data-operational-area={area}>
      {children}
    </div>
  );
}
