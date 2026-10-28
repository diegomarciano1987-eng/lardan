import { useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2, Printer, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QZ_DOWNLOAD, lerEstacao, listarImpressoras, salvarEstacao, type EstacaoArgox } from "@/lib/argox-direta";

/** Ligação deste computador com a Argox (programa QZ Tray, impressora e linguagem). */
export function EstacaoArgoxPainel() {
  const [est, setEst] = useState<EstacaoArgox>({ impressora: null, linguagem: "pplb" });
  const [lista, setLista] = useState<string[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const atualizar = async () => {
    setBusy(true); setErro(null);
    try {
      const l = await listarImpressoras(); setLista(l);
      const atual = lerEstacao();
      if (!atual.impressora) { const a = l.filter((n) => /argox/i.test(n)); if (a.length === 1) { atual.impressora = a[0]!; salvarEstacao(atual); } }
      setEst(atual);
    } catch (e) { setLista(null); setErro(e instanceof Error ? e.message : "Não foi possível falar com o programa de impressão."); }
    finally { setBusy(false); }
  };
  useEffect(() => { setEst(lerEstacao()); void atualizar(); }, []);
  const mudar = (e: EstacaoArgox) => { setEst(e); salvarEstacao(e); };

  return <section className="rounded-xl border border-line p-4" data-testid="estacao-argox">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold">Impressão direta neste computador</p>
      <Button variant="outline" size="sm" onClick={() => void atualizar()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}Verificar</Button>
    </div>
    {erro ? <div className="mt-3 grid gap-2 text-sm">
      <p className="flex items-start gap-2 font-semibold text-destructive"><TriangleAlert className="mt-0.5 size-4 shrink-0" />Programa de impressão direta não encontrado neste computador.</p>
      <ol className="list-decimal space-y-1 pl-5 text-ledger-muted">
        <li>Baixe e instale o <b>QZ Tray</b> (gratuito) — uma vez por computador.</li>
        <li>Baixe o <b>certificado LARDAN</b>, renomeie para <b>override.crt</b> e coloque na pasta do QZ Tray (C:\\Program Files\\QZ Tray). Assim ele não pergunta nada a cada etiqueta.</li>
        <li>Abra o QZ Tray e clique em <b>Verificar</b>.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm"><a href={QZ_DOWNLOAD} target="_blank" rel="noreferrer"><Download />Baixar QZ Tray</a></Button>
        <Button asChild size="sm" variant="outline"><a href="/qz/lardan-qz.crt" download="override.crt"><Download />Baixar certificado LARDAN</a></Button>
      </div>
    </div> : lista && <div className="mt-3 grid gap-3 text-sm">
      <p className="flex items-center gap-2 text-ledger-muted"><CheckCircle2 className="size-4 text-success" />Programa conectado. Escolha a Argox deste computador:</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Impressora de etiquetas">
        {lista.map((n) => <Button key={n} size="sm" role="radio" aria-checked={est.impressora === n} variant={est.impressora === n ? "default" : "outline"} onClick={() => mudar({ ...est, impressora: n, linguagem: /ppla/i.test(n) ? "ppla" : est.linguagem })}><Printer />{n}</Button>)}
      </div>
      <div>
        <p className="font-semibold">Linguagem da Argox</p>
        <p className="text-xs text-ledger-muted">Se a amostra sair em branco ou com letras estranhas, troque e teste de novo.</p>
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Linguagem">
          {([["pplb", "PPLB (padrão)"], ["ppla", "PPLA"], ["pplz", "PPLZ"]] as const).map(([v, r]) => <Button key={v} size="sm" role="radio" aria-checked={est.linguagem === v} variant={est.linguagem === v ? "default" : "outline"} onClick={() => mudar({ ...est, linguagem: v })}>{r}</Button>)}
        </div>
      </div>
    </div>}
  </section>;
}
