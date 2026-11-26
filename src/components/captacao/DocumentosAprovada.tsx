/**
 * 0398 — Página da candidata aprovada para enviar os documentos (Diego/Daniel, 26/11).
 * 4 itens, cada um com imagem de exemplo: documento com foto, comprovante de residência,
 * selfie segurando o documento ao lado do rosto e foto da frente da casa que vai receber as maletas.
 * A foto é reduzida no próprio celular (até 1600 px, JPEG) antes de subir; PDF só no comprovante.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, CheckCircle2, ImagePlus, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  BUCKET_DOCUMENTOS, documentoEnvioConfirmar, documentoEnvioPreparar, documentosAbrir, documentosFinalizar,
  type PaginaDocumentos, type TipoDocumento,
} from "@/lib/captacao/documentos.functions";

export const ITENS_DOCUMENTO: { tipo: TipoDocumento; titulo: string; dica: string; camera: "user" | "environment"; pdf: boolean }[] = [
  { tipo: "documento", titulo: "Documento com foto", camera: "environment", pdf: false,
    dica: "RG ou CNH aberto, com a foto e os dados bem legíveis. Sem reflexo e sem cortar as pontas." },
  { tipo: "comprovante", titulo: "Comprovante de residência", camera: "environment", pdf: true,
    dica: "Conta de luz, água, internet ou telefone dos últimos 3 meses, com o endereço inteiro aparecendo. Pode ser foto ou PDF." },
  { tipo: "selfie", titulo: "Selfie com o documento", camera: "user", pdf: false,
    dica: "Segure o mesmo documento ao lado do rosto, com o rosto e a foto do documento aparecendo. Lugar claro, sem boné e sem óculos escuros." },
  { tipo: "fachada", titulo: "Frente da casa", camera: "environment", pdf: false,
    dica: "Foto da frente da casa que vai receber as maletas, de onde dê para ver o portão ou a porta e, se tiver, o número." },
];

/** Ilustrações de exemplo (traço simples, sem dado de ninguém). */
export function ExemploDocumento({ tipo, className }: { tipo: TipoDocumento; className?: string }) {
  const comum = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 160 110" className={className} role="img" aria-label={`Exemplo: ${ITENS_DOCUMENTO.find((i) => i.tipo === tipo)?.titulo}`}>
      {tipo === "documento" && (
        <g {...comum}>
          <rect x="18" y="18" width="124" height="76" rx="8" />
          <rect x="30" y="32" width="34" height="44" rx="4" />
          <circle cx="47" cy="47" r="7" />
          <path d="M37 70c2-7 18-7 20 0" />
          <path d="M76 36h52M76 48h40M76 60h48M76 72h30" opacity=".6" />
        </g>
      )}
      {tipo === "comprovante" && (
        <g {...comum}>
          <path d="M44 8h56l18 18v76H44z" />
          <path d="M100 8v18h18" />
          <path d="M54 36h40M54 46h52" opacity=".6" />
          <rect x="52" y="56" width="58" height="14" rx="3" strokeDasharray="4 3" />
          <path d="M57 63h40" />
          <path d="M54 80h24M54 90h30" opacity=".6" />
          <text x="98" y="93" fontSize="11" fill="currentColor" stroke="none" fontFamily="sans-serif">R$</text>
        </g>
      )}
      {tipo === "selfie" && (
        <g {...comum}>
          <circle cx="58" cy="44" r="20" />
          <path d="M51 41h.01M65 41h.01" strokeWidth="3" />
          <path d="M51 52c4 4 10 4 14 0" />
          <path d="M28 104c4-20 18-30 30-30s26 10 30 30" />
          <rect x="94" y="30" width="48" height="32" rx="4" />
          <rect x="99" y="35" width="14" height="20" rx="2" />
          <path d="M118 40h18M118 47h14M118 54h16" opacity=".6" />
          <path d="M88 70c4-4 8-8 10-8" />
        </g>
      )}
      {tipo === "fachada" && (
        <g {...comum}>
          <path d="M20 54 80 14l60 40" />
          <path d="M32 46v54h96V46" />
          <rect x="68" y="66" width="24" height="34" rx="2" />
          <rect x="42" y="60" width="18" height="16" rx="2" />
          <rect x="100" y="60" width="18" height="16" rx="2" />
          <rect x="96" y="84" width="16" height="9" rx="1.5" />
          <text x="99" y="91.5" fontSize="7" fill="currentColor" stroke="none" fontFamily="sans-serif">123</text>
          <path d="M8 100h144" />
        </g>
      )}
    </svg>
  );
}

/** Reduz a foto no aparelho. Se o navegador não abrir o formato (ex.: HEIC fora do iPhone), manda o original. */
async function prepararArquivo(f: File): Promise<{ blob: Blob; ext: "jpg" | "png" | "webp" | "heic" | "pdf"; mime: string }> {
  if (f.type === "application/pdf") return { blob: f, ext: "pdf", mime: f.type };
  try {
    const bmp = await createImageBitmap(f);
    const escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * escala);
    c.height = Math.round(bmp.height * escala);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.82));
    if (blob && blob.size > 0) return { blob, ext: "jpg", mime: "image/jpeg" };
  } catch { /* segue com o original */ }
  const t = f.type.toLowerCase();
  if (t === "image/png") return { blob: f, ext: "png", mime: t };
  if (t === "image/webp") return { blob: f, ext: "webp", mime: t };
  if (t === "image/heic" || t === "image/heif" || /\.hei[cf]$/i.test(f.name)) return { blob: f, ext: "heic", mime: "image/heic" };
  if (t === "image/jpeg") return { blob: f, ext: "jpg", mime: t };
  throw new Error("Formato não aceito. Envie uma foto (ou PDF, só no comprovante).");
}

export function DocumentosAprovada({ token }: { token: string }) {
  const qc = useQueryClient();
  const abrir = useServerFn(documentosAbrir);
  const finalizar = useServerFn(documentosFinalizar);
  const chave = ["documentos", token];
  const q = useQuery({ queryKey: chave, queryFn: () => abrir({ data: { token } }), retry: false });
  const fim = useMutation({
    mutationFn: () => finalizar({ data: { token } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chave }),
  });

  if (q.isLoading) return <p className="p-8 text-center text-muted-foreground">Abrindo…</p>;
  if (q.error) return <p className="mx-auto max-w-md p-8 text-center text-sm">{(q.error as Error).message}</p>;
  const p = q.data as PaginaDocumentos;
  const por = new Map(p.itens.map((i) => [i.tipo, i]));
  const prontos = ITENS_DOCUMENTO.filter((i) => { const s = por.get(i.tipo)?.situacao; return s === "enviado" || s === "conferido"; }).length;
  const refazer = p.itens.filter((i) => i.situacao === "refazer").length;

  if (p.finalizado_em && !refazer) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-5 py-10 text-center">
        <CheckCircle2 className="mx-auto size-12 text-primary" aria-hidden />
        <h1 className="font-display text-2xl">Pronto, {p.primeiro_nome}!</h1>
        <p className="text-muted-foreground">
          Recebemos os seus documentos. A equipe da Lardan confere e, em seguida, prepara a sua maleta.
          Se precisarmos de alguma foto de novo, avisamos você pelo WhatsApp e este mesmo link volta a funcionar.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-5 px-5 py-6">
      <section className="space-y-2">
        <h1 className="font-display text-2xl leading-tight">Parabéns, {p.primeiro_nome}! Seu cadastro foi aprovado.</h1>
        <p className="text-sm text-muted-foreground">
          Para seguir com a sua maleta, precisamos de 4 fotos. Leva uns 5 minutos. Veja o exemplo de cada uma antes de tirar.
        </p>
        <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          As fotos ficam guardadas com segurança e só a equipe da Lardan vê. Elas servem para confirmar quem você é e o endereço de entrega.
        </p>
      </section>

      {ITENS_DOCUMENTO.map((item, i) => (
        <Item key={item.tipo} token={token} n={i + 1} item={item} atual={por.get(item.tipo) ?? null} onEnviado={() => void qc.invalidateQueries({ queryKey: chave })} />
      ))}

      <div className="sticky bottom-0 -mx-5 border-t border-border bg-background px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {fim.error && <p className="mb-2 text-sm text-destructive">{(fim.error as Error).message}</p>}
        <button type="button" disabled={prontos < 4 || fim.isPending} onClick={() => fim.mutate()}
          className="min-h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {fim.isPending ? "Enviando…" : prontos < 4 ? `Faltam ${4 - prontos} de 4` : "Enviar para a Lardan"}
        </button>
      </div>
    </div>
  );
}

function Item({ token, n, item, atual, onEnviado }: {
  token: string; n: number; item: (typeof ITENS_DOCUMENTO)[number]; atual: PaginaDocumentos["itens"][number] | null; onEnviado: () => void;
}) {
  const preparar = useServerFn(documentoEnvioPreparar);
  const confirmar = useServerFn(documentoEnvioConfirmar);
  const camRef = React.useRef<HTMLInputElement>(null);
  const galRef = React.useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = React.useState<string | null>(null);
  React.useEffect(() => () => { if (previa) URL.revokeObjectURL(previa); }, [previa]);

  const envio = useMutation({
    mutationFn: async (f: File) => {
      if (f.size > 25 * 1024 * 1024) throw new Error("Arquivo grande demais. Tire a foto de novo.");
      if (f.type === "application/pdf" && !item.pdf) throw new Error("Aqui precisa ser uma foto.");
      const a = await prepararArquivo(f);
      if (a.blob.size > 10 * 1024 * 1024) throw new Error("Arquivo maior que 10 MB. Tire a foto de novo.");
      const p = await preparar({ data: { token, tipo: item.tipo, ext: a.ext } });
      const up = await supabase.storage.from(BUCKET_DOCUMENTOS).uploadToSignedUrl(p.caminho, p.tokenEnvio, a.blob, { contentType: a.mime });
      if (up.error) throw new Error("A foto não subiu. Confira a internet e tente de novo.");
      await confirmar({ data: { token, tipo: item.tipo, caminho: p.caminho } });
      return a;
    },
    onSuccess: (a) => { if (a.mime.startsWith("image/") && a.ext !== "heic") setPrevia(URL.createObjectURL(a.blob)); onEnviado(); },
  });
  const escolher = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) envio.mutate(f); };

  const sit = atual?.situacao ?? null;
  const conferido = sit === "conferido";
  const ok = sit === "enviado" || conferido;
  return (
    <section className={`rounded-2xl border p-4 ${sit === "refazer" ? "border-destructive/60" : ok ? "border-primary/40" : "border-border"}`} aria-labelledby={`doc-${item.tipo}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 id={`doc-${item.tipo}`} className="text-base font-semibold"><span className="text-muted-foreground">{n}.</span> {item.titulo}</h2>
        {ok && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"><CheckCircle2 className="size-3.5" aria-hidden />{conferido ? "Conferido" : "Enviado"}</span>}
        {sit === "refazer" && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">Enviar de novo</span>}
      </div>
      {sit === "refazer" && atual?.motivo && <p className="mt-2 rounded-lg bg-destructive/5 p-2 text-sm text-destructive">{atual.motivo}</p>}
      <div className="mt-3 grid grid-cols-[7rem_1fr] items-center gap-3">
        <div className="rounded-xl bg-muted/60 p-2 text-muted-foreground">
          {previa ? <img src={previa} alt={`Sua foto: ${item.titulo}`} className="aspect-[16/11] w-full rounded-lg object-cover" /> : <ExemploDocumento tipo={item.tipo} className="w-full" />}
          <p className="mt-1 text-center text-[0.65rem] uppercase tracking-wide">{previa ? "Sua foto" : "Exemplo"}</p>
        </div>
        <p className="text-sm text-muted-foreground">{item.dica}</p>
      </div>
      {!conferido && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={envio.isPending} onClick={() => camRef.current?.click()}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-primary px-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {envio.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : ok ? <RotateCcw className="size-4" aria-hidden /> : <Camera className="size-4" aria-hidden />}
            {envio.isPending ? "Enviando…" : ok ? "Tirar de novo" : "Tirar foto"}
          </button>
          <button type="button" disabled={envio.isPending} onClick={() => galRef.current?.click()}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border px-2 text-sm disabled:opacity-50">
            <ImagePlus className="size-4" aria-hidden /> {item.pdf ? "Galeria ou PDF" : "Da galeria"}
          </button>
          <input ref={camRef} type="file" accept="image/*" capture={item.camera} className="sr-only" tabIndex={-1} aria-hidden onChange={escolher} />
          <input ref={galRef} type="file" accept={item.pdf ? "image/*,application/pdf" : "image/*"} className="sr-only" tabIndex={-1} aria-hidden onChange={escolher} />
        </div>
      )}
      {envio.error && <p className="mt-2 text-sm text-destructive" role="alert">{(envio.error as Error).message}</p>}
    </section>
  );
}
