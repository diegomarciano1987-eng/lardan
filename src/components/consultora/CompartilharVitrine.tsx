/**
 * Botão pequeno "Compartilhar vitrine" no topo do Início (celular).
 * Lê só o endereço e se a vitrine está no ar (consultant_showcases, leitura da própria dona).
 * No ar: abre o compartilhar do celular (WhatsApp, Instagram…); sem suporte, abre o WhatsApp.
 * Fora do ar: leva para "Minha vitrine" para publicar.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { meuParty } from "@/lib/consultora";
import { urlPublica } from "@/lib/pedido-publico";

async function minhaVitrine(): Promise<{ slug: string | null; no_ar: boolean }> {
  const party = await meuParty();
  const { data, error } = await supabase.from("consultant_showcases").select("slug, is_public").eq("party_id", party).maybeSingle();
  if (error) throw error;
  return { slug: data?.slug ?? null, no_ar: Boolean(data?.is_public && data?.slug) };
}

export function BotaoCompartilharVitrine({ abrirVitrine, nome }: { abrirVitrine: () => void; nome?: string | null | undefined }) {
  const q = useQuery({ queryKey: ["consultora", "vitrine-link"], queryFn: minhaVitrine, staleTime: 5 * 60_000, retry: false });
  const [ocupado, setOcupado] = React.useState(false);

  const compartilhar = async () => {
    const v = q.data;
    if (!v?.no_ar || !v.slug) {
      toast.info("Sua vitrine ainda não está no ar. Publique para poder compartilhar.");
      abrirVitrine();
      return;
    }
    const url = urlPublica(`/${v.slug}`);
    const texto = `Conheça minha vitrine de semijoias LARDAN${nome ? `, com ${nome}` : ""}:`;
    setOcupado(true);
    try {
      if ("share" in navigator) {
        try { await navigator.share({ title: "Minha vitrine LARDAN", text: texto, url }); return; }
        catch (e) { if ((e as Error)?.name === "AbortError") return; }
      }
      window.open(`https://wa.me/?text=${encodeURIComponent(`${texto} ${url}`)}`, "_blank", "noopener");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void compartilhar()}
      disabled={q.isLoading || ocupado}
      aria-label="Compartilhar minha vitrine"
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3.5 text-[0.9rem] font-semibold leading-none text-primary shadow-[var(--shadow-app)] transition active:scale-95 disabled:opacity-60"
    >
      <Share2 className="size-4" aria-hidden />
      Compartilhar vitrine
    </button>
  );
}
