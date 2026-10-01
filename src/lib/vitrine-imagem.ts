import type { Recorte } from "@/lib/vitrine-design";

export const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp"];
export const MAX_BYTES = 15 * 1024 * 1024;

/** Lê o arquivo respeitando a orientação da câmera. Recusa o que não for imagem real. */
export async function abrirImagem(file: File): Promise<ImageBitmap> {
  if (!TIPOS_ACEITOS.includes(file.type)) throw new Error("Use uma foto em JPG, PNG ou WEBP.");
  if (file.size > MAX_BYTES) throw new Error("A foto passa de 15 MB. Escolha uma menor.");
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Não conseguimos abrir esta imagem. Tente outra foto.");
  }
}

function toBlob(c: HTMLCanvasElement, tipo = "image/webp", q = 0.86) {
  return new Promise<Blob>((ok, falha) =>
    c.toBlob((b) => (b ? ok(b) : falha(new Error("Não foi possível preparar a imagem."))), tipo, q),
  );
}

/**
 * Desenha um recorte. x/y = deslocamento do centro em % do lado do quadro;
 * zoom ≥ 1 sobre o "cobrir"; rot em graus (múltiplos de 90 ou livre).
 * O redesenho no canvas descarta metadados (localização, aparelho).
 */
export function desenhar(img: ImageBitmap, r: Recorte, w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const rad = (r.rot * Math.PI) / 180;
  const girada = Math.abs(Math.round(r.rot / 90)) % 2 === 1;
  const iw = girada ? img.height : img.width;
  const ih = girada ? img.width : img.height;
  const escala = Math.max(w / iw, h / ih) * r.zoom;
  ctx.translate(w / 2 + (r.x / 100) * w, h / 2 + (r.y / 100) * h);
  ctx.rotate(rad);
  ctx.scale(escala, escala);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  return c;
}

/** Lado efetivo (px da foto original) que cabe no quadro: serve para avisar baixa resolução. */
export function ladoUtil(img: ImageBitmap, r: Recorte, w: number, h: number) {
  const girada = Math.abs(Math.round(r.rot / 90)) % 2 === 1;
  const iw = girada ? img.height : img.width;
  const ih = girada ? img.width : img.height;
  const escala = Math.max(w / iw, h / ih) * r.zoom;
  return Math.round(w / escala);
}

export async function gerarTamanhos(img: ImageBitmap, r: Recorte, tamanhos: { w: number; h: number }[]) {
  return Promise.all(tamanhos.map(async (t) => toBlob(desenhar(img, r, t.w, t.h))));
}

/** Original reduzido a no máximo 2400px e sem metadados, para reenquadrar depois. */
export async function originalLimpo(img: ImageBitmap) {
  const f = Math.min(1, 2400 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * f);
  c.height = Math.round(img.height * f);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return toBlob(c, "image/jpeg", 0.9);
}

/** Imagem de apresentação 1200×630 no modelo Lardan: capa, retrato e nome. */
export async function gerarImagemCompartilhar(opts: {
  capa: string | null;
  retrato: string | null;
  nome: string;
  frase: string;
}) {
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 630;
  const ctx = c.getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  const cor = (v: string, alt: string) => css.getPropertyValue(v).trim() || alt;
  ctx.fillStyle = cor("--vitrine-og-fundo", "#1c1714");
  ctx.fillRect(0, 0, 1200, 630);
  const carregar = (src: string) =>
    new Promise<HTMLImageElement>((ok, falha) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => ok(i);
      i.onerror = falha;
      i.src = src;
    });
  if (opts.capa) {
    try {
      const i = await carregar(opts.capa);
      const e = Math.max(720 / i.width, 630 / i.height);
      ctx.save(); ctx.beginPath(); ctx.rect(480, 0, 720, 630); ctx.clip();
      ctx.drawImage(i, 480 + (720 - i.width * e) / 2, (630 - i.height * e) / 2, i.width * e, i.height * e);
      ctx.restore();
      const g = ctx.createLinearGradient(480, 0, 700, 0);
      g.addColorStop(0, cor("--vitrine-og-fundo", "#1c1714"));
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(480, 0, 220, 630);
    } catch { /* segue sem capa */ }
  }
  const ouro = cor("--vitrine-og-ouro", "#c9a27a");
  const claro = cor("--vitrine-og-texto", "#f7f1ea");
  if (opts.retrato) {
    try {
      const i = await carregar(opts.retrato);
      ctx.save();
      ctx.beginPath();
      ctx.arc(150, 200, 90, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(i, 60, 110, 180, 180);
      ctx.restore();
      ctx.strokeStyle = ouro;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(150, 200, 96, 0, Math.PI * 2);
      ctx.stroke();
    } catch { /* segue sem retrato */ }
  }
  ctx.fillStyle = ouro;
  ctx.font = "500 20px Jost, sans-serif";
  ctx.fillText("C O N S U L T O R A   L A R D A N", 60, 360);
  ctx.fillStyle = claro;
  ctx.font = "52px 'Roxborough CF', 'Cormorant Garamond', Georgia, serif";
  ctx.fillText(opts.nome.slice(0, 26), 60, 430);
  ctx.font = "300 24px Jost, sans-serif";
  ctx.globalAlpha = 0.85;
  ctx.fillText(opts.frase.slice(0, 44), 60, 480);
  ctx.globalAlpha = 1;
  ctx.fillStyle = ouro;
  ctx.fillRect(60, 530, 60, 2);
  ctx.font = "500 18px Jost, sans-serif";
  ctx.fillText("lardan.com.br", 60, 570);
  return toBlob(c, "image/jpeg", 0.88);
}
