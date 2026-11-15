import { describe, it, expect } from "vitest";
import { APPOINTMENT_NOTES_MAX_LENGTH } from "@/lib/appointment-limits";
import { notesChange } from "@/lib/appointment-notes";

describe("notesChange — notatki w PUT tylko po zmianie (#90)", () => {
  const overLimit = "x".repeat(APPOINTMENT_NOTES_MAX_LENGTH + 500);

  it("nietknięte notatki ponad limit (sprzed #71) => brak pola", () => {
    expect(notesChange(overLimit, overLimit)).toEqual({});
  });

  it.each([
    ["bez zmian", "Alergia", "Alergia"],
    ["spacje na końcu", "Alergia  ", "Alergia"],
    ["puste i null", "", null],
    ["same spacje i null", "   ", null],
    ["same spacje i pusty tekst", "  ", ""],
    // Surowe body przed poprawką Ryana zapisywało same spacje bez zmian.
    ["same spacje zapisane przed poprawką PUT", "   ", "   "],
  ])("%s => brak pola", (_name, edited, original) => {
    expect(notesChange(edited, original)).toEqual({});
  });

  it("zmieniona treść => przycięta wartość", () => {
    expect(notesChange("  Nowa uwaga ", "Stara")).toEqual({ notes: "Nowa uwaga" });
  });

  it.each(["", "   "])("wyczyszczenie istniejących notatek (%j) => null", (edited) => {
    expect(notesChange(edited, "Stara")).toEqual({ notes: null });
  });

  it("dopisanie do pustej wizyty => wartość", () => {
    expect(notesChange("Pierwsza", null)).toEqual({ notes: "Pierwsza" });
  });

  it("edycja notatek ponad limit nadal je wysyła (serwer odpowie 400)", () => {
    expect(notesChange(overLimit.slice(1), overLimit)).toEqual({ notes: overLimit.slice(1) });
  });
});
