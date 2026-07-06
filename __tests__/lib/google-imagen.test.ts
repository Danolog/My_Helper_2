import { describe, it, expect } from "vitest";
import { IMAGEN_MODEL } from "@/lib/ai/google-imagen";

describe("IMAGEN_MODEL", () => {
  // Google wycofal rodzine imagen-3.x z Generative Language API (404
  // NOT_FOUND, potwierdzone 2026-07-06). Dostepne sa modele imagen-4.x.
  it("does not use the retired imagen-3.x family", () => {
    expect(IMAGEN_MODEL).not.toMatch(/^imagen-3\./);
  });

  it("uses a model from the imagen-4.x family", () => {
    expect(IMAGEN_MODEL).toMatch(/^imagen-4\./);
  });
});
