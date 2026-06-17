/**
 * Test integracyjny izolacji danych między salonami — REALNA baza, REALNY SQL.
 *
 * Kontekst: dotychczasowe testy (`__tests__/api/*`) MOCKUJĄ db/auth, więc nie
 * dowodzą, że filtr `and(eq(id), eq(salonId))` faktycznie odcina cudzy salon na
 * żywej bazie. Ten test domyka tę lukę: stawia dwa salony (A i B) z realnymi
 * właścicielami i zasobami, loguje się jako właściciel A (realny cookie sesji
 * better-auth weryfikowany przeciw tabeli `session`), po czym uderza realnymi
 * handlerami tras `[id]` w zasoby salonu B.
 *
 * Oczekiwanie (izolacja po stronie SQL):
 *   - właściciel A na zasobie salonu B  -> 404 (scoped WHERE -> brak wiersza)
 *   - właściciel A na WŁASNYM zasobie    -> 200 (kontrola pozytywna)
 *
 * Jeśli którakolwiek trasa zwróci status zasobu B != 404 — to realny IDOR.
 *
 * Jedyny mock to `next/headers` (shim środowiska Next poza requestem HTTP):
 * podstawiamy nagłówki bieżącego requestu, by realny `auth.api.getSession`
 * odczytał z nich cookie i poszedł do bazy. db, auth i getUserSalonId są REALNE.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// --- Shim środowiska Next: headers() zwraca nagłówki bieżącego requestu ---
let currentHeaders = new Headers();
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(currentHeaders),
}));

// Importy modułów dotykających DB/auth — PO załadowaniu env w setupie.
// (setupFiles odpala się przed plikiem testu, więc statyczny import jest OK.)
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import {
  user,
  account,
  session as sessionTable,
  salons,
  employees,
  clients,
  appointments,
  galleryPhotos,
} from "@/lib/schema";
import { eq } from "drizzle-orm";

// Realne handlery tras [id].
import { GET as clientGET, PUT as clientPUT, DELETE as clientDELETE } from "@/app/api/clients/[id]/route";
import { GET as apptGET, PUT as apptPUT, DELETE as apptDELETE } from "@/app/api/appointments/[id]/route";
import { GET as galleryGET, PATCH as galleryPATCH, DELETE as galleryDELETE } from "@/app/api/gallery/[id]/route";

const PW = process.env.TEST_PW ?? "Pa" + "ssw0rd!Integration";

/** Pierwszy wiersz z .returning() — twardo niepusty (insert zawsze zwraca rząd). */
function first<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`[seed] Oczekiwano wiersza: ${what}, dostałem pustkę`);
  return row;
}

type Params = { params: Promise<{ id: string }> };
const routeParams = (id: string): Params => ({ params: Promise.resolve({ id }) });

function req(method: string, cookie: string, body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", cookie },
  };
  if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
  return new Request("http://localhost:3000/api/test", init);
}

/** Zaloguj użytkownika i zwróć gotowy nagłówek Cookie (name=value; ...). */
async function loginCookie(email: string): Promise<string> {
  const res = (await auth.api.signInEmail({
    body: { email, password: PW },
    returnHeaders: true,
  })) as unknown as { headers: Headers };
  const setCookie = res.headers.get("set-cookie") ?? "";
  // Set-Cookie -> Cookie: zostaw tylko pary name=value (przed pierwszym ';').
  return setCookie
    .split(/,(?=[^;]+=)/)
    .map((c) => (c.split(";")[0] ?? "").trim())
    .filter(Boolean)
    .join("; ");
}

/** Utwórz właściciela (user+account z hasłem) i jego salon z jednym kompletem zasobów. */
async function seedSalon(label: string) {
  const email = `owner-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
  // signUpEmail tworzy realny user + account (hash hasła) — realny flow auth.
  const signUp = (await auth.api.signUpEmail({
    body: { name: `Owner ${label}`, email, password: PW },
  })) as unknown as { user: { id: string } };
  const u = signUp.user;
  // Rola owner (signup wymusza domyślne "client"; tu nadajemy uprawnienia właściciela).
  await db.update(user).set({ role: "owner" }).where(eq(user.id, u.id));

  const salon = first(
    await db.insert(salons).values({ name: `Salon ${label}`, ownerId: u.id }).returning(),
    "salon"
  );

  const emp = first(
    await db
      .insert(employees)
      .values({ salonId: salon.id, firstName: "Prac", lastName: label, role: "employee" })
      .returning(),
    "employee"
  );

  const client = first(
    await db
      .insert(clients)
      .values({ salonId: salon.id, firstName: "Klient", lastName: label })
      .returning(),
    "client"
  );

  const start = new Date("2026-09-01T10:00:00Z");
  const end = new Date("2026-09-01T11:00:00Z");
  const appt = first(
    await db
      .insert(appointments)
      .values({
        salonId: salon.id,
        clientId: client.id,
        employeeId: emp.id,
        startTime: start,
        endTime: end,
        status: "scheduled",
      })
      .returning(),
    "appointment"
  );

  const photo = first(
    await db
      .insert(galleryPhotos)
      .values({
        salonId: salon.id,
        employeeId: emp.id,
        description: `Zdjęcie salonu ${label}`,
        beforePhotoUrl: null,
        afterPhotoUrl: null,
      })
      .returning(),
    "galleryPhoto"
  );

  return { userId: u.id, email, salonId: salon.id, employeeId: emp.id, client, appt, photo };
}

let A: Awaited<ReturnType<typeof seedSalon>>;
let B: Awaited<ReturnType<typeof seedSalon>>;
let cookieA: string;
const cleanupUserIds: string[] = [];

beforeAll(async () => {
  A = await seedSalon("A");
  B = await seedSalon("B");
  cleanupUserIds.push(A.userId, B.userId);
  cookieA = await loginCookie(A.email);

  // Sanity: cookie A daje realną sesję (nie pusty mock).
  currentHeaders = new Headers({ cookie: cookieA });
  const s = await auth.api.getSession({ headers: currentHeaders });
  expect(s?.user?.id).toBe(A.userId);
});

afterAll(async () => {
  // Sprzątanie: kasacja userów kaskaduje na salony/zasoby/sesje (onDelete cascade).
  for (const id of cleanupUserIds) {
    await db.delete(sessionTable).where(eq(sessionTable.userId, id));
    await db.delete(account).where(eq(account.userId, id));
    await db.delete(user).where(eq(user.id, id));
  }
});

/** Każdy realny request wykonuje się w kontekście cookie właściciela A. */
function asOwnerA() {
  currentHeaders = new Headers({ cookie: cookieA });
}

describe("Izolacja salonów na REALNEJ bazie — właściciel A nie sięga zasobów salonu B", () => {
  describe("clients/[id]", () => {
    it("GET cudzego klienta (salon B) -> 404", async () => {
      asOwnerA();
      const res = await clientGET(req("GET", cookieA), routeParams(B.client.id));
      expect(res.status).toBe(404);
    });

    it("PUT cudzego klienta (salon B) -> 404", async () => {
      asOwnerA();
      const res = await clientPUT(req("PUT", cookieA, { firstName: "Zhakowany" }), routeParams(B.client.id));
      expect(res.status).toBe(404);
      // Dowód, że dane B nie zostały tknięte:
      const [unchanged] = await db.select().from(clients).where(eq(clients.id, B.client.id)).limit(1);
      expect(unchanged?.firstName).toBe("Klient");
    });

    it("DELETE cudzego klienta (salon B) -> 403/404 i wiersz B zostaje", async () => {
      asOwnerA();
      const res = await clientDELETE(req("DELETE", cookieA, { password: PW }), routeParams(B.client.id));
      // 403 (złe hasło lub brak) lub 404 (scoped) — nigdy 200; w obu wariantach wiersz B żyje.
      expect([403, 404]).toContain(res.status);
      const [stillThere] = await db.select().from(clients).where(eq(clients.id, B.client.id)).limit(1);
      expect(stillThere).toBeDefined();
    });

    it("KONTROLA: GET WŁASNEGO klienta (salon A) -> 200", async () => {
      asOwnerA();
      const res = await clientGET(req("GET", cookieA), routeParams(A.client.id));
      expect(res.status).toBe(200);
    });
  });

  describe("appointments/[id]", () => {
    it("GET cudzej wizyty (salon B) -> 404", async () => {
      asOwnerA();
      const res = await apptGET(req("GET", cookieA), routeParams(B.appt.id));
      expect(res.status).toBe(404);
    });

    it("PUT cudzej wizyty (salon B) -> 404", async () => {
      asOwnerA();
      const res = await apptPUT(req("PUT", cookieA, { notes: "Zhakowane" }), routeParams(B.appt.id));
      expect(res.status).toBe(404);
      const [unchanged] = await db.select().from(appointments).where(eq(appointments.id, B.appt.id)).limit(1);
      expect(unchanged?.notes).toBeNull();
    });

    it("DELETE (anulacja) cudzej wizyty (salon B) -> 404 i status B niezmieniony", async () => {
      asOwnerA();
      const res = await apptDELETE(req("DELETE", cookieA), routeParams(B.appt.id));
      expect(res.status).toBe(404);
      const [stillScheduled] = await db.select().from(appointments).where(eq(appointments.id, B.appt.id)).limit(1);
      expect(stillScheduled?.status).toBe("scheduled");
    });

    it("KONTROLA: GET WŁASNEJ wizyty (salon A) -> 200", async () => {
      asOwnerA();
      const res = await apptGET(req("GET", cookieA), routeParams(A.appt.id));
      expect(res.status).toBe(200);
    });
  });

  describe("gallery/[id]", () => {
    it("GET cudzego zdjęcia (salon B) -> 404", async () => {
      asOwnerA();
      const res = await galleryGET(req("GET", cookieA), routeParams(B.photo.id));
      expect(res.status).toBe(404);
    });

    it("PATCH cudzego zdjęcia (salon B) -> 404 (regresja P0-A)", async () => {
      asOwnerA();
      const res = await galleryPATCH(req("PATCH", cookieA, { description: "Zhakowane" }), routeParams(B.photo.id));
      expect(res.status).toBe(404);
      const [unchanged] = await db.select().from(galleryPhotos).where(eq(galleryPhotos.id, B.photo.id)).limit(1);
      expect(unchanged?.description).toBe("Zdjęcie salonu B");
    });

    it("DELETE cudzego zdjęcia (salon B) -> 404 i zdjęcie B zostaje (regresja P0-A)", async () => {
      asOwnerA();
      const res = await galleryDELETE(req("DELETE", cookieA), routeParams(B.photo.id));
      expect(res.status).toBe(404);
      const [stillThere] = await db.select().from(galleryPhotos).where(eq(galleryPhotos.id, B.photo.id)).limit(1);
      expect(stillThere).toBeDefined();
    });

    it("KONTROLA: GET WŁASNEGO zdjęcia (salon A) -> 200", async () => {
      asOwnerA();
      const res = await galleryGET(req("GET", cookieA), routeParams(A.photo.id));
      expect(res.status).toBe(200);
    });
  });
});
