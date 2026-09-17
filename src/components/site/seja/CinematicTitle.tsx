import { useEffect, useRef, type CSSProperties, type ElementType } from "react";

type CinematicTitleProps = {
  as?: "h1" | "h2" | "h3";
  children: string;
  className?: string;
  id?: string;
};

type LetterStyle = CSSProperties & { "--letter-index": number };

/**
 * Mantém o título integral e semântico para leitores de tela. Visualmente,
 * cada caractere ganha uma revelação suave quando chega à viewport.
 */
export function CinematicTitle({
  as = "h2",
  children,
  className = "",
  id,
}: CinematicTitleProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  const Tag = as as ElementType;

  useEffect(() => {
    const heading = ref.current;
    if (!heading) return;

    heading.classList.add("cinematic-title-ready");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        heading.classList.add("cinematic-title-visible");
        observer.disconnect();
      },
      { threshold: 0.28, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(heading);
    return () => observer.disconnect();
  }, []);

  let visibleIndex = 0;

  return (
    <Tag ref={ref} id={id} className={`cinematic-title ${className}`}>
      <span className="sr-only">{children}</span>
      <span aria-hidden="true" className="cinematic-title-visual">
        {children.split(" ").map((word, wordIndex, words) => (
          <span className="cinematic-title-word" key={`${word}-${wordIndex}`}>
            {Array.from(word).map((letter, letterIndex) => {
              const index = visibleIndex++;
              return (
                <span
                  className="cinematic-title-letter"
                  key={`${letter}-${letterIndex}`}
                  style={{ "--letter-index": index } as LetterStyle}
                >
                  {letter}
                </span>
              );
            })}
            {wordIndex < words.length - 1 ? "\u00a0" : null}
          </span>
        ))}
      </span>
    </Tag>
  );
}