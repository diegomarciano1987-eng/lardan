import { createFileRoute } from "@tanstack/react-router";
import { llmsTxt } from "@/lib/public-text";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () =>
        new Response(llmsTxt(), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=300, s-maxage=3600",
          },
        }),
    },
  },
});
