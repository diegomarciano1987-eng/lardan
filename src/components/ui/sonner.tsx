import { Toaster as Sonner, toast, type ToasterProps } from "sonner";
import { Check, Info, TriangleAlert } from "lucide-react";
import { avisoPt } from "@/lib/aviso-pt";

/**
 * 0300 (Diego, 12/11/2026): nenhum aviso em inglês. Todo toast.* passa por avisoPt (título e
 * descrição); texto em português segue igual. Feito uma vez, aqui, para valer no sistema inteiro.
 */
type Fn = (m: unknown, d?: { description?: unknown } & Record<string, unknown>) => string | number;
const traduzir = (v: unknown) => (typeof v === "string" ? avisoPt(v) : v);
const marcado = toast as unknown as Record<string, unknown> & { __pt?: boolean };
if (!marcado.__pt) {
  marcado.__pt = true;
  for (const k of ["success", "error", "warning", "info", "message", "loading"] as const) {
    const orig = marcado[k] as Fn;
    marcado[k] = ((m: unknown, d?: { description?: unknown } & Record<string, unknown>) =>
      orig(traduzir(m), d && "description" in d ? { ...d, description: traduzir(d.description) } : d)) as Fn;
  }
}

/**
 * Avisos no idioma visual da LARDAN: cartão de vidro escuro, fio champagne,
 * título em serifa e selo losango. Nada de estilo padrão de navegador.
 */
const Toaster = (props: ToasterProps) => {
  return (
    <Sonner
      className="lardan-toaster"
      position="top-center"
      offset={24}
      gap={14}
      duration={4200}
      closeButton
      containerAriaLabel="Avisos"
      icons={{
        success: <Check className="size-4" strokeWidth={2} aria-hidden />,
        error: <TriangleAlert className="size-4" strokeWidth={2} aria-hidden />,
        warning: <TriangleAlert className="size-4" strokeWidth={2} aria-hidden />,
        info: <Info className="size-4" strokeWidth={2} aria-hidden />,
        loading: <span className="lardan-toast__spin" aria-hidden />,
      }}
      toastOptions={{
        unstyled: true,
        closeButton: true,
        closeButtonAriaLabel: "Fechar aviso",
        classNames: {
          toast: "lardan-toast",
          title: "lardan-toast__title",
          description: "lardan-toast__desc",
          icon: "lardan-toast__icon",
          content: "lardan-toast__content",
          closeButton: "lardan-toast__close",
          actionButton: "lardan-toast__action",
          cancelButton: "lardan-toast__cancel",
          success: "lardan-toast--success",
          error: "lardan-toast--error",
          warning: "lardan-toast--warning",
          info: "lardan-toast--info",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
