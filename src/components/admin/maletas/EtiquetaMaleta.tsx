import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { detalheMaleta } from "@/lib/maletas";
import { CONFIG_ETIQUETA, documentoEtiquetas, svgEtiqueta } from "@/lib/etiquetas";

export function EtiquetaMaleta({ cycleId, preview = false }: { cycleId: string; preview?: boolean }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const ficha = useQuery({ queryKey: ["maletas", "detalhe", cycleId], queryFn: () => detalheMaleta(cycleId) });
  const code = ficha.data?.maleta.codigo;
  let svg = "";
  let invalid = "";
  if (code) { try { svg = svgEtiqueta(code); } catch (e) { invalid = e instanceof Error ? e.message : "Código inválido"; } }
  function imprimir() {
    if (!code) return;
    try {
      let config = CONFIG_ETIQUETA;
      try { const saved = JSON.parse(localStorage.getItem("lardan.etiquetas.argox.alca-direita.v2") ?? "null"); if (saved) config = { ...config, ...saved }; } catch { /* Defaults */ }
      const html = documentoEtiquetas([{ id: cycleId, nome: `Maleta ${code}`, referencia: code, barcode: code, quantidade: 1 }], config);
      const w = window.open("", "_blank", "width=900,height=650");
      if (!w) throw new Error("Permita pop-ups para abrir a impressão.");
      w.document.write(html); w.document.close(); w.focus(); w.setTimeout(() => w.print(), 250);
      setNotice("Janela aberta; impressão física não confirmada."); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível imprimir."); }
  }
  return <div className="space-y-2 text-ledger-text">
    {preview && svg && <div className="rounded-md border border-line bg-surface p-4"><div className="flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} /><p className="mt-2 text-center text-sm font-semibold">{code}</p></div>}
    <Button variant="outline" disabled={!code || !!invalid} onClick={imprimir}><Printer />Etiqueta da maleta</Button>
    {ficha.isPending && <p className="text-xs text-ledger-muted">Carregando código…</p>}
    {ficha.isError && <p role="alert" className="text-xs text-destructive">Não foi possível ler a identificação. <Button variant="link" onClick={() => void ficha.refetch()}>Tentar novamente</Button></p>}
    {(error || invalid) && <p role="alert" className="text-xs text-destructive">{error || invalid}</p>}
    {notice && <p role="status" className="text-xs text-ledger-muted">{notice}</p>}
  </div>;
}