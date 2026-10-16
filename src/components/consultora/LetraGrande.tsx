import * as React from "react";
import { Switch } from "@/components/ui/switch";
import { Type } from "lucide-react";

const CHAVE = "lardan-consultora-letra-grande";
export function useLetraGrande() {
  const [grande, setGrande] = React.useState(false);
  React.useEffect(() => {
    const ler = () => { try { setGrande(localStorage.getItem(CHAVE) === "1"); } catch { /* preferência opcional */ } };
    ler(); window.addEventListener("lardan:letra", ler);
    return () => window.removeEventListener("lardan:letra", ler);
  }, []);
  return grande;
}
export function LetraGrande() {
  const grande = useLetraGrande();
  return <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
    <Type className="size-7 shrink-0" />
    <label htmlFor="letra-grande" className="min-w-0 flex-1 text-lg font-semibold">Letra grande <span className="block text-base font-normal">+20%</span></label>
    <Switch id="letra-grande" checked={grande} onCheckedChange={(v) => { try { localStorage.setItem(CHAVE, v ? "1" : "0"); window.dispatchEvent(new Event("lardan:letra")); } catch { /* preferência opcional */ } }} />
  </div>;
}