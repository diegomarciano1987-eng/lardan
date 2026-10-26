import { Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { definirTemaConsultora, useTemaConsultora } from "@/lib/consultora-tema";

/** Liga/desliga do modo claro do app da consultora. Escuro é o padrão. */
export function TemaClaroEscuro() {
  const tema = useTemaConsultora();
  const claro = tema === "light";
  const Icone = claro ? Sun : Moon;
  return <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
    <Icone className="size-7 shrink-0 text-primary" aria-hidden />
    <label htmlFor="tema-claro" className="min-w-0 flex-1 text-lg font-semibold">
      Modo claro
      <span className="block text-base font-normal text-muted-foreground">{claro ? "Ligado — tela clara" : "Desligado — tela escura"}</span>
    </label>
    <Switch id="tema-claro" checked={claro} onCheckedChange={(v) => definirTemaConsultora(v ? "light" : "dark")} />
  </div>;
}
