import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Pico de acessos pelo celular (representante alterna WhatsApp ↔ app o tempo todo):
  // - staleTime curto evita recarregar TODAS as telas a cada volta ao app; salvar algo continua
  //   atualizando na hora (as telas invalidam a consulta depois de gravar);
  // - erro de permissão/regra não é repetido 3 vezes (a mensagem aparece na hora);
  //   falha de rede tenta de novo até 2 vezes.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        retry: (falhas, erro) => {
          const msg = String((erro as { message?: unknown } | null)?.message ?? erro ?? "");
          if (/permiss|não pode|nao pode|inválid|invalid|não encontrad|42501|PGRST|JWT|sessão/i.test(msg)) return false;
          return falhas < 2;
        },
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
