import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { detalheMaleta } from "@/lib/maletas";
import { svgEtiqueta } from "@/lib/etiquetas";
import { imprimirDireto, lerEstacao } from "@/lib/argox-direta";
import { comandosEtiquetaMaleta, linhasEtiquetaMaleta, type DadosEtiquetaMaleta } from "@/lib/etiqueta-maleta-raw";
import { supabase } from "@/integrations/supabase/client";

export function EtiquetaMaleta({ cycleId, preview = false }: { cycleId: string; preview?: boolean }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const ficha = useQuery({ queryKey: ["maletas", "detalhe", cycleId], queryFn: () => detalheMaleta(cycleId) });
  const dados = useQuery({ queryKey: ["maletas", "etiqueta-dados", cycleId], queryFn: async () => {
    const { data, error } = await supabase.rpc("kit_etiqueta_maleta_dados" as never, { _cycle: cycleId } as never);
    if (error) throw error;
    return (data ?? {}) as DadosEtiquetaMaleta;
  } });
  const code = ficha.data?.maleta.codigo;
  const L = linhasEtiquetaMaleta(dados.data ?? {});
  let svg = "";
  let invalid = "";
  if (code) { try { svg = svgEtiqueta(code); } catch (e) { invalid = e instanceof Error ? e.message : "Código inválido"; } }
  async function imprimir() {
    if (!code) return;
    try {
      await imprimirDireto(comandosEtiquetaMaleta(code, lerEstacao().linguagem, 1, dados.data ?? {}));
      setNotice("Impressão preparada; saída física não confirmada."); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível imprimir."); }
  }
  return <div className="space-y-2 text-ledger-text">
    {preview && svg && <div className="max-w-xs rounded-md border border-line bg-surface p-4 font-mono text-xs uppercase leading-tight"><p>{L.l1 || "—"}</p><p>{L.l2 || "—"}</p><p>{L.l3 || "—"}</p><div className="my-1 flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} /><div className="flex justify-between text-2xl font-bold"><span>{L.remessa}</span><span>{L.maleta}</span></div></div>}
    <Button variant="outline" disabled={!code || !!invalid || dados.isPending} onClick={imprimir}><Printer />Etiqueta da maleta (48×28 mm)</Button>
    {ficha.isPending && <p className="text-xs text-ledger-muted">Carregando código…</p>}
    {ficha.isError && <p role="alert" className="text-xs text-destructive">Não foi possível ler a identificação. <Button variant="link" onClick={() => void ficha.refetch()}>Tentar novamente</Button></p>}
    {(error || invalid) && <p role="alert" className="text-xs text-destructive">{error || invalid}</p>}
    {notice && <p role="status" className="text-xs text-ledger-muted">{notice}</p>}
  </div>;
}