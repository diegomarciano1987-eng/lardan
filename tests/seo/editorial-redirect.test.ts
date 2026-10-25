import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { beforeLoad: () => void }) => options,
  redirect: (options: { to: string; statusCode: number }) => options,
}));

import { Route } from "../../src/routes/semijoia-folheado-ou-bijuteria";

describe("Consolidated comparison guide", () => {
  it("permanently redirects the legacy URL to the retained guide", () => {
    const options = Route as unknown as { beforeLoad: () => void };
    expect(options.beforeLoad).toThrow(expect.objectContaining({
      to: "/guia/semijoia-folheado-ou-bijuteria",
      statusCode: 301,
    }));
  });
});