import { useEffect, useRef, useState } from "react";

interface Props {
  poster: string;
  webm: string;
  mp4: string;
  className?: string;
}

/**
 * Vídeo de fundo com carregamento inteligente.
 *
 * O poster aparece imediatamente; o vídeo só é montado e reproduzido quando a
 * seção se aproxima da viewport. Com "reduzir movimento" ativo, o poster
 * estático é suficiente — nenhum vídeo é baixado.
 */
export function VideoFundo({ poster, webm, mp4, className }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [ativo, setAtivo] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const obs = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setAtivo(true);
          obs.disconnect();
        }
      },
      // Começa a preparar um pouco antes de a seção entrar na tela.
      { rootMargin: "300px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !ativo) return;
    el.load();
    void el.play().catch(() => {
      /* navegador pode recusar autoplay: o poster permanece */
    });
  }, [ativo]);

  return (
    <video
      ref={ref}
      aria-hidden="true"
      autoPlay
      loop
      muted
      playsInline
      preload="none"
      poster={poster}
      {...(className ? { className } : {})}
    >
      {ativo ? (
        <>
          <source src={webm} type="video/webm" />
          <source src={mp4} type="video/mp4" />
        </>
      ) : null}
    </video>
  );
}
