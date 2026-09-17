import { createFileRoute } from "@tanstack/react-router";
import { robotsTxt } from "@/lib/public-text";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () =>
        new Response(robotsTxt(), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=300, s-maxage=3600",
          },
        }),
    },
  },
});
