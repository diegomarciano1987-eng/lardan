import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FotoPropriaPeca } from "@/components/vitrine/FotoPropriaPeca";
import { linksPrevia } from "@/lib/vitrine-design";

/** 0298: fotos que a própria consultora tirou das peças (só ela lê; vale só na vitrine dela). */
export function useFotosProprias(userId: string) {
  return useQuery({
    queryKey: ["consultora", "fotos-proprias", userId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: perfil } = await supabase.from("profiles").select("party_id").eq("id", userId).maybeSingle();
      const party = (perfil as { party_id: string | null } | null)?.party_id ?? null;
      const { data, error } = await supabase.from("vitrine_fotos_proprias").select("variant_id, path");
      if (error) throw error;
      const linhas = (data ?? []) as { variant_id: string; path: string }[];
      const links = await linksPrevia(linhas.map((l) => l.path));
      const mapa: Record<string, string> = {};
      linhas.forEach((l) => { const u = links[l.path]; if (u) mapa[l.variant_id] = u; });
      return { party, mapa, tem: new Set(linhas.map((l) => l.variant_id)) };
    },
  });
}

/** Botão da câmera na lista "Minhas peças": abre o enquadramento e guarda a foto só para a vitrine dela. */
export function BotaoFotoPropria({ userId, party, variantId, produto, temPropria, temOficial, children }: {
  userId: string; party: string; variantId: string; produto: string; temPropria: boolean; temOficial: boolean; children: React.ReactNode;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <button type="button" className="relative shrink-0 rounded-xl"
        aria-label={temPropria ? `Trocar sua foto de ${produto}` : `Tirar foto de ${produto} para sua vitrine`} onClick={() => setAberto(true)}>
        {children}
        <span aria-hidden className={`absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full border shadow-sm ${!temPropria && !temOficial ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"}`}>
          <Camera className="size-3.5" />
        </span>
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Foto para a sua vitrine</DialogTitle></DialogHeader>
          <FotoPropriaPeca party={party} variantId={variantId} produto={produto} temPropria={temPropria} temOficial={temOficial}
            onMudou={async () => {
              await Promise.all([
                qc.invalidateQueries({ queryKey: ["consultora", "fotos-proprias", userId] }),
                qc.invalidateQueries({ queryKey: ["consultora", "estudio"] }),
              ]);
              setAberto(false);
            }} />
        </DialogContent>
      </Dialog>
    </>
  );
}
