import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Endereço do site anterior que o Google ainda mostra (Página institucional do site antigo).
 * 301 para a página equivalente atual, preservando o tráfego e os links.
 */
export const Route = createFileRoute("/about")({
  beforeLoad: () => {
    throw redirect({ to: "/a-lardan", statusCode: 301 });
  },
});
