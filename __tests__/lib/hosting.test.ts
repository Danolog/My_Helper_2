import { describe, it, expect } from "vitest";
import { hostingPlatform } from "@/lib/hosting";

describe("hostingPlatform (#106)", () => {
  it("VERCEL=1 → Vercel (pierwszeństwo przed K_SERVICE)", () => {
    expect(hostingPlatform({ VERCEL: "1" })).toBe("Vercel");
    expect(hostingPlatform({ VERCEL: "1", K_SERVICE: "x" })).toBe("Vercel");
  });
  it("K_SERVICE niepusty → Cloud Run", () => {
    expect(hostingPlatform({ K_SERVICE: "myhelper" })).toBe("Cloud Run");
  });
  it.each([{}, { VERCEL: "0" }, { VERCEL: "true" }, { K_SERVICE: "" }, { K_SERVICE: "  " }])(
    "%j → brak hostingu",
    (env) => {
      expect(hostingPlatform(env)).toBeNull();
    },
  );
});
