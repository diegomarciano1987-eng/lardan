import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Printer, RotateCcw, Save, Ruler } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AMOSTRA_CALIBRACAO, CONFIG_ETIQUETA, ETIQUETA, LIMITES_CALIBRACAO, completarConfig, documentoTeste,
  lerCalibracao, salvarCalibracao, textoEtiqueta, validarCalibracao, type EtiquetaConfig,
} from "@/lib/etiquetas";
import { lerCalibracaoGlobal, salvarCalibracaoGlobal } from "@/lib/etiquetas-calibracao";
import { imprimirPdf, pdfTeste } from "@/lib/etiquetas-pdf";

type Campo = keyof typeof LIMITES_CALIBRACAO;
const CAMPOS: { key: Campo; titulo: string; dica: string; passo: number; un: string }[] = [
  { key: "margemEsquerda", titulo: "Mover para a direita", dica: "Saiu cortado à esquerda? aumente.", passo: 0.5, un: "mm" },
  { key: "margemSuperior", titulo: "Mover para baixo", dica: "Saiu cortado em cima? aumente.", passo: 0.5, un: "mm" },
  { key: "entreLinhas", titulo: "Espaço entre etiquetas", dica: "Cada etiqueta desce mais que a anterior? ajuste.", passo: 0.5, un: "mm" },
  { key: "areaLargura", titulo: "Largura da área impressa", dica: "Barras apertadas ou cortadas à direita.", passo: 1, un: "mm" },
  { key: "alturaBarras", titulo: "Altura das barras", dica: "Leitor não lê? aumente um pouco.", passo: 0.2, un: "mm" },
  { key: "fonteNome", titulo: "Letra do nome", dica: "Nome da peça na linha de cima.", passo: 0.5, un: "pt" },
  { key: "fonteReferencia", titulo: "Letra da referência", dica: "Linha REFERÊNCIA-PREÇO.", passo: 0.5, un: "pt" },
];
const arred = (n: number) => Math.round(n * 10) / 10;

/** Calibração da Argox desta estação com prévia em escala real e impressão de teste. */
export function CalibracaoArgox() {
  const [cfg, setCfg] = useState<Required<EtiquetaConfig>>(completarConfig(null));
  const [salvo, setSalvo] = useState<Required<EtiquetaConfig>>(completarConfig(null));
  useEffect(() => { const c = lerCalibracao(); setCfg(c); setSalvo(c); void lerCalibracaoGlobal().then((g) => { setCfg(g); setSalvo(g); }); }, []);
  const erro = validarCalibracao(cfg);
  const alterado = JSON.stringify(cfg) !== JSON.stringify(salvo);
  const previa = useMemo(() => { try { return documentoTeste("amostra", cfg); } catch { return null; } }, [cfg]);
  const ajustar = (k: Campo, v: number) => {
    const [min, max] = LIMITES_CALIBRACAO[k];
    setCfg((c) => ({ ...c, [k]: arred(Math.min(max, Math.max(min, v))) }));
  };
  const testar = async (modo: "amostra" | "regua") => {
    try { imprimirPdf(await pdfTeste(modo, cfg, modo === "amostra" ? 3 : 1)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível imprimir o teste."); }
  };
  const salvar = async () => {
    try { await salvarCalibracaoGlobal(cfg); setSalvo(cfg); toast.success("Calibração salva para todas as colaboradoras. As próximas etiquetas já saem assim."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível salvar."); }
  };
  // Escala de tela: 1 mm = 4 px na prévia.
  const esc = 4; const altura = ETIQUETA.altura + cfg.entreLinhas;

  return <div className="grid gap-5" data-testid="calibracao-argox">
    <section className="rounded-xl border border-line p-4">
      <p className="text-sm font-semibold">Como calibrar</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ledger-muted">
        <li>Clique em <b>Imprimir régua</b> e meça na fita onde a moldura caiu.</li>
        <li>Ajuste os números abaixo; a prévia muda na hora.</li>
        <li>Clique em <b>Imprimir 3 amostras</b>, confira e bipe o código.</li>
        <li>Ficou certo? <b>Salvar calibração</b>.</li>
      </ol>
      <p className="mt-3 text-xs text-ledger-muted">Na janela de impressão: escolha a Argox, <b>Margens: Nenhuma</b>, <b>Escala: 100%</b> e desmarque <b>Cabeçalhos e rodapés</b> (em “Mais definições”). É isso que tira data, endereço e textos estranhos da etiqueta.</p>
    </section>

    <section className="rounded-xl border border-line p-4">
      <p className="mb-3 text-sm font-semibold">Prévia (ampliada 4×, fita de {ETIQUETA.suporte} × {arred(altura)} mm)</p>
      <div className="overflow-x-auto">
        <div className="relative rounded-md bg-white shadow-inner" style={{ width: ETIQUETA.suporte * esc, height: altura * esc }}>
          {previa && <iframe title="Prévia da etiqueta" srcDoc={previa} className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
            style={{ width: `${ETIQUETA.suporte}mm`, height: `${altura}mm`, transform: `scale(${esc / (96 / 25.4)})` }} />}
          <div aria-hidden className="pointer-events-none absolute border border-dashed border-destructive/60" style={{ left: cfg.margemEsquerda * esc, top: cfg.margemSuperior * esc, width: cfg.areaLargura * esc, height: ETIQUETA.altura * esc }} />
        </div>
      </div>
      <p className="mt-2 text-xs text-ledger-muted">Amostra fixa: {AMOSTRA_CALIBRACAO.nome} · {textoEtiqueta(AMOSTRA_CALIBRACAO.referencia, AMOSTRA_CALIBRACAO.precoCents)}. Tracejado = área impressa.</p>
    </section>

    <section className="grid gap-3 sm:grid-cols-2">
      {CAMPOS.map(({ key, titulo, dica, passo, un }) => {
        const [min, max] = LIMITES_CALIBRACAO[key];
        return <div key={key} className="rounded-xl border border-line p-3">
          <p className="text-sm font-semibold">{titulo}</p>
          <p className="text-xs text-ledger-muted">{dica}</p>
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" variant="outline" size="icon" aria-label={`Diminuir ${titulo}`} onClick={() => ajustar(key, cfg[key] - passo)} disabled={cfg[key] <= min}><Minus /></Button>
            <input className="admin-input w-24 text-center" inputMode="decimal" aria-label={titulo} value={String(cfg[key]).replace(".", ",")}
              onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); if (Number.isFinite(n)) setCfg((c) => ({ ...c, [key]: n })); }} />
            <span className="text-xs text-ledger-muted">{un}</span>
            <Button type="button" variant="outline" size="icon" aria-label={`Aumentar ${titulo}`} onClick={() => ajustar(key, cfg[key] + passo)} disabled={cfg[key] >= max}><Plus /></Button>
          </div>
          <p className="mt-1 text-[11px] text-ledger-muted">de {String(min).replace(".", ",")} a {String(max).replace(".", ",")} {un}</p>
        </div>;
      })}
    </section>

    {erro && <p role="alert" className="text-sm font-semibold text-destructive">{erro}</p>}

    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
      <Button variant="ghost" onClick={() => setCfg(completarConfig(CONFIG_ETIQUETA))}><RotateCcw />Voltar ao padrão</Button>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!!erro} onClick={() => testar("regua")}><Ruler />Imprimir régua</Button>
        <Button variant="outline" disabled={!!erro} onClick={() => testar("amostra")}><Printer />Imprimir 3 amostras</Button>
        <Button disabled={!!erro || !alterado} onClick={salvar}><Save />{alterado ? "Salvar calibração" : "Calibração salva"}</Button>
      </div>
    </div>
  </div>;
}
