import { Link } from "@tanstack/react-router";

interface CategorySceneProps {
  title: string;
  to: string;
  image: { url: string };
  imageAlt: string;
  reverse?: boolean;
}

export function CategoryScene({ title, to, image, imageAlt, reverse }: CategorySceneProps) {
  return (
    <section
      className={`mx-auto grid max-w-6xl items-center gap-10 px-6 py-24 md:grid-cols-2 ${
        reverse ? "md:[&>*:first-child]:order-2" : ""
      }`}
    >
      <div className="overflow-hidden rounded-2xl" style={{ boxShadow: "var(--shadow-soft)" }}>
        <img
          src={image.url}
          alt={imageAlt}
          loading="lazy"
          width={1664}
          height={928}
          className="aspect-[16/10] w-full object-cover"
        />
      </div>
      <div className={reverse ? "md:pr-8" : "md:pl-8"}>
        <p className="brand-eyebrow mb-3">Categoria</p>
        <h2 className="text-4xl text-foreground md:text-5xl">{title}</h2>
        <div className="rose-rule mt-6 w-16" />
        <Link
          to={to}
          className="mt-8 inline-flex items-center rounded-full border border-primary/40 px-7 py-3 text-[0.75rem] tracking-[0.22em] uppercase text-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          Ver {title.toLowerCase()}
        </Link>
      </div>
    </section>
  );
}
