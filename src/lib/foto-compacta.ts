/**
 * Foto tirada no celular (3–12 MB) vira JPEG de no máximo 1600 px antes de subir.
 * Na estrada, com 3G/4G fraco, a foto grande é a principal causa de "não enviou".
 * Sem suporte no navegador, ou se o resultado não ficar menor, devolve o arquivo original.
 */
export async function compactarFoto(arquivo: File, ladoMaximo = 1600, qualidade = 0.82): Promise<File> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return arquivo;
  if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type) || arquivo.size < 600_000) return arquivo;
  try {
    const img = await createImageBitmap(arquivo, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const escala = Math.min(1, ladoMaximo / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * escala));
    const h = Math.max(1, Math.round(img.height * escala));
    const tela = document.createElement("canvas");
    tela.width = w;
    tela.height = h;
    const ctx = tela.getContext("2d");
    if (!ctx) return arquivo;
    ctx.fillStyle = "#ffffff"; // PNG com fundo transparente não fica preto no JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    img.close?.();
    const blob = await new Promise<Blob | null>((ok) => tela.toBlob(ok, "image/jpeg", qualidade));
    if (!blob || blob.size >= arquivo.size) return arquivo;
    return new File([blob], arquivo.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return arquivo;
  }
}
