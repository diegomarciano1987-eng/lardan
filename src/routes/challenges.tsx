import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Endereço do site anterior que o Google ainda mostra (Página de desafios do site antigo).
 * 301 para a página equivalente atual, preservando o tráfego e os links.
 */
export const Route = createFileRoute("/challenges")({
  beforeLoad: () => {
    throw redirect({ to: "/seja-lardan", statusCode: 301 });
  },
});
