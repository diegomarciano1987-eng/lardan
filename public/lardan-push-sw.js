/**
 * LARDAN — trabalhador de notificações.
 *
 * Só existe para mostrar o aviso de nova candidatura. Não guarda páginas,
 * não serve arquivos do site e não interfere no funcionamento normal.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evento) => evento.waitUntil(self.clients.claim()));

self.addEventListener("push", (evento) => {
  let dados = {};
  try {
    dados = evento.data ? evento.data.json() : {};
  } catch {
    dados = { titulo: "Lardan", corpo: evento.data ? evento.data.text() : "" };
  }

  const titulo = dados.titulo || "Nova candidatura";
  const opcoes = {
    body: dados.corpo || "",
    icon: "/icon-192.png",
    badge: "/favicon-48.png",
    tag: dados.tag || "lardan-candidatura",
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: { url: dados.url || "/admin/candidaturas" },
  };

  evento.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const destino = (evento.notification.data && evento.notification.data.url) || "/admin/candidaturas";

  evento.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const janela of janelas) {
        if (janela.url.includes(destino) && "focus" in janela) return janela.focus();
      }
      for (const janela of janelas) {
        if ("navigate" in janela) {
          await janela.navigate(destino);
          return janela.focus();
        }
      }
      return self.clients.openWindow(destino);
    })(),
  );
});
