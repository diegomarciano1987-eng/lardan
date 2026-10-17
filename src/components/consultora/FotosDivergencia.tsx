import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "consultora-pos-venda";
const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Até 3 fotos privadas da peça com problema, na conferência da chegada da maleta. */
export function FotosDivergencia({ cycleId, variantId, produto }: { cycleId: string; variantId: string; produto: string }) {
  const qc = useQueryClient();
  const chave = ["consultora", "div-fotos", cycleId, variantId];
  const ref = React.useRef<HTMLInputElement>(null);
  const fotos = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await supabase.from("kit_divergencia_fotos").select("path").eq("cycle_id", cycleId).eq("variant_id", variantId).order("created_at");
      if (error) throw error;
      const urls = await Promise.all((data ?? []).map(async (f) => (await supabase.storage.from(BUCKET).createSignedUrl(f.path, 600)).data?.signedUrl ?? null));
      return urls.filter((u): u is string => !!u);
    },
  });
  const enviar = useMutation({
    mutationFn: async (arq: File) => {
      const ext = TIPOS[arq.type];
      if (!ext) throw new Error("Use foto JPG, PNG ou WEBP.");
      if (arq.size > 8 * 1024 * 1024) throw new Error("Foto acima de 8 MB.");
      const uid = (await supabase.auth.getUser()).data.user?.id;
      if (!uid) throw new Error("Entre novamente.");
      const path = `${uid}/maleta-${cycleId}/${variantId}-${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from(BUCKET).upload(path, arq, { contentType: arq.type, upsert: false });
      if (up.error) throw up.error;
      const r = await supabase.rpc("kit_divergencia_foto_registrar", { _cycle: cycleId, _variant: variantId, _path: path });
      if (r.error) { await supabase.storage.from(BUCKET).remove([path]); throw r.error; }
    },
    onSuccess: () => { toast.success("Foto anexada."); void qc.invalidateQueries({ queryKey: chave }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const n = fotos.data?.length ?? 0;
  return (
    <div className="grid gap-2">
      <span className="text-[0.95rem] font-medium">Fotos do problema <span className="font-normal text-ledger-muted">(até 3, só a LARDAN vê)</span></span>
      <div className="flex flex-wrap items-center gap-2">
        {fotos.data?.map((u) => <img key={u} src={u} alt={`Foto do problema em ${produto}`} className="size-16 rounded-xl object-cover" />)}
        {n < 3 && (
          <button type="button" className="admin-btn min-h-12 text-base" disabled={enviar.isPending} onClick={() => ref.current?.click()}>
            <Camera className="size-5" aria-hidden /> {enviar.isPending ? "Enviando…" : n ? "Outra foto" : "Tirar ou escolher foto"}
          </button>
        )}
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) enviar.mutate(f); }} />
      </div>
    </div>
  );
}
