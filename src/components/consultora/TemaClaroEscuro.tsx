import { Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { definirTemaConsultora, useTemaConsultora } from "@/lib/consultora-tema";

/** Liga/desliga do modo escuro (vidro fumê) do app da consultora. O claro é o padrão. */
export function TemaClaroEscuro() {
  const tema = useTemaConsultora();
  const escuro = tema === "dark";
  const Icone = escuro ? Moon : Sun;
  return <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
    <Icone className="size-7 shrink-0 text-primary" aria-hidden />
    <label htmlFor="tema-escuro" className="min-w-0 flex-1 text-lg font-semibold">
      Modo escuro
      <span className="block text-base font-normal text-muted-foreground">{escuro ? "Ligado — vidro fumê" : "Desligado — tela clara"}</span>
    </label>
    <Switch id="tema-escuro" checked={escuro} onCheckedChange={(v) => definirTemaConsultora(v ? "dark" : "light")} />
  </div>;
}
