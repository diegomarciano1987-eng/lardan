import { Toaster as Sonner, type ToasterProps } from "sonner";
import { Check, Info, TriangleAlert } from "lucide-react";

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
