import * as React from "react";
import { AlertTriangle, RotateCcw, RotateCw } from "lucide-react";
import { desenhar, ladoUtil } from "@/lib/vitrine-imagem";
import type { Recorte } from "@/lib/vitrine-design";

interface Props {
  img: ImageBitmap;
  inicial?: Recorte | null;
  /** proporção largura/altura do quadro final */
  proporcao: number;
  redondo?: boolean;
  /** lado mínimo recomendado, em px da foto original */
  minimo: number;
  onCancelar: () => void;
  onConfirmar: (r: Recorte) => void;
  confirmando?: boolean;
}

/** Recorte com arrastar, zoom e rotação. Sem filtros nem retoques. */
export function RecorteFoto({ img, inicial, proporcao, redondo, minimo, onCancelar, onConfirmar, confirmando }: Props) {
  const [r, setR] = React.useState<Recorte>(inicial ?? { x: 0, y: 0, zoom: 1, rot: 0 });
  const tela = React.useRef<HTMLCanvasElement>(null);
  const arrasto = React.useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const W = 320;
  const H = Math.round(W / proporcao);

  React.useEffect(() => {
    const c = desenhar(img, r, W * 2, H * 2);
    const ctx = tela.current?.getContext("2d");
    if (ctx && tela.current) {
      tela.current.width = W * 2;
      tela.current.height = H * 2;
      ctx.drawImage(c, 0, 0);
    }
  }, [img, r, H]);

  const util = ladoUtil(img, r, 1000, Math.round(1000 / proporcao));
  const baixa = util < minimo;

  return (
    <div className="space-y-4">
      <div className="relative mx-auto touch-none select-none overflow-hidden rounded-xl bg-muted" style={{ width: W, height: H }}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); arrasto.current = { px: e.clientX, py: e.clientY, x: r.x, y: r.y }; }}
        onPointerMove={(e) => {
          const a = arrasto.current; if (!a) return;
          setR((v) => ({ ...v, x: a.x + ((e.clientX - a.px) / W) * 100, y: a.y + ((e.clientY - a.py) / H) * 100 }));
        }}
        onPointerUp={() => { arrasto.current = null; }}
      >
        <canvas ref={tela} style={{ width: W, height: H }} className="cursor-grab" />
        {redondo && (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 rounded-full shadow-[0_0_0_999px_color-mix(in_oklab,var(--foreground)_45%,transparent)]" />
            <div className="absolute left-1/2 top-[18%] h-[52%] w-[40%] -translate-x-1/2 rounded-[50%] border border-dashed border-background/80" />
          </div>
        )}
      </div>
      {redondo && <p className="text-center text-xs text-muted-foreground">Arraste a foto para centralizar o rosto dentro da linha pontilhada, com um pouco de espaço acima da cabeça.</p>}
      {!redondo && <p className="text-center text-xs text-muted-foreground">Arraste para escolher a parte da imagem que aparece.</p>}

      <label className="grid gap-1 text-xs">
        <span className="uppercase tracking-widest text-muted-foreground">Aproximar</span>
        <input type="range" min={1} max={3} step={0.01} value={r.zoom} onChange={(e) => setR((v) => ({ ...v, zoom: Number(e.target.value) }))} className="accent-primary" />
      </label>
      <div className="flex items-center justify-center gap-2">
        <button type="button" className="admin-btn" onClick={() => setR((v) => ({ ...v, rot: v.rot - 90 }))}><RotateCcw className="size-4" /> Girar</button>
        <button type="button" className="admin-btn" onClick={() => setR((v) => ({ ...v, rot: v.rot + 90 }))}><RotateCw className="size-4" /> Girar</button>
        <button type="button" className="admin-btn" onClick={() => setR({ x: 0, y: 0, zoom: 1, rot: 0 })}>Recomeçar</button>
      </div>
      {baixa && (
        <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Esta foto tem pouca resolução para este enquadramento e pode ficar sem nitidez. Afaste o zoom ou use uma foto maior.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="admin-btn" onClick={onCancelar}>Cancelar</button>
        <button type="button" className="admin-btn admin-btn-primary" disabled={confirmando} onClick={() => onConfirmar(r)}>
          {confirmando ? "Preparando…" : "Usar esta foto"}
        </button>
      </div>
    </div>
  );
}
