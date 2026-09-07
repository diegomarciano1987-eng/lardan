import { useEffect, useRef, useState } from "react";

/**
 * Barra de progresso da apresentação de abertura (hero → segunda sessão).
 * Fica fixa no topo, acima do menu, e enche conforme a pessoa rola: 0% no
 * primeiro pixel e 100% exatamente quando a segunda sessão termina de
 * entrar por completo na tela. A partir daí permanece cheia, marcando que
 * a apresentação foi concluída.
 */
export function IntroProgress() {
  const [progress, setProgress] = useState(0);
  const concluidoRef = useRef(false);

  useEffect(() => {
    let alvo: HTMLElement | null = null;
    let frame = 0;

    const measure = () => {
      // Mede a segunda sessão pela marcação, sem depender de constantes.
      if (!alvo) alvo = document.querySelector<HTMLElement>("[data-intro-scroll]");
      const fim = alvo
        ? alvo.offsetTop + alvo.offsetHeight - window.innerHeight
        : document.documentElement.scrollHeight * 0.4;
      const bruto = fim > 0 ? Math.min(1, Math.max(0, window.scrollY / fim)) : 0;
      // ~1/300 de passo: suave ao olho, barato para o navegador.
      const q = Math.round(bruto * 300) / 300;
      setProgress((atual) => (q === atual ? atual : q));
      if (bruto >= 1 && !concluidoRef.current) concluidoRef.current = true;
    };

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("orientationchange", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[70]"
    >
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label="Progresso da apresentação"
        className="h-[3px] w-full origin-left bg-primary/70"
        style={{
          transform: `scaleX(${progress})`,
          boxShadow:
            "0 1px 10px oklch(0.66 0.07 28 / 0.45), 0 0 18px oklch(0.66 0.07 28 / 0.3)",
          transition: "transform 80ms linear",
        }}
      />
      {/* Brilho que viaja na ponta da barra enquanto ela avança. */}
      <div
        className="absolute top-0 h-[3px] w-16"
        style={{
          left: `calc(${progress * 100}% - 3rem)`,
          opacity: progress > 0.003 && progress < 0.999 ? 1 : 0,
          background:
            "linear-gradient(90deg, transparent 0%, oklch(1 0 0 / 0.85) 55%, oklch(1 0 0) 100%)",
          filter: "blur(1px)",
          transition: "opacity 200ms ease",
        }}
      />
    </div>
  );
}
