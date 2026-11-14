import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { linkEmployeeAccountSchema } from "@/lib/api-validation";
// ADR-001 sekcja 4 (weryfikacja tożsamości cross-tenant): lookup konta po e-mailu
// (tabela user better-auth, bez salon_id) oraz sprawdzenie, czy konto nie jest już
// podpięte pod pracownika INNEGO salonu / nie należy do właściciela salonu, z
// definicji wykraczają poza forSalon(salonId) — świadomie surowe db.
// eslint-disable-next-line no-restricted-imports
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { employees, salons, user } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import type { z } from "zod";

// PUT /api/employees/[id]/link-account - Podepnij/odepnij konto użytkownika
// do pracownika (email = null => odłączenie). Wyłącznie właściciel salonu.
export const PUT = withApiHandler(
  {
    auth: "user",
    schema: linkEmployeeAccountSchema as z.ZodType<{ email: string | null }>,
    logLabel: "[Employees API] PUT link-account",
    errorMessage: "Nie udalo sie zaktualizowac konta pracownika",
  },
  async ({ body, params }) => {
    // Tenant isolation (ADR-001): salon TYLKO z sesji właściciela —
    // getUserSalonId rozpoznaje wyłącznie salons.ownerId.
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const id = params.id!; // segment [id] zawsze obecny w trasie dynamicznej

    // Pracownik musi należeć do salonu wołającego (cudzy/nieistniejący => 404)
    const employee = await forSalon(salonId).findOne(employees, id);
    if (!employee) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono pracownika" },
        { status: 404 }
      );
    }

    // email = null => odłączenie konta od pracownika
    if (body.email === null) {
      const updated = await forSalon(salonId).updateOwned(employees, id, {
        userId: null,
      });
      logger.info(`[Employees API] Unlinked account from employee ${id}`);
      return NextResponse.json({ success: true, data: updated });
    }

    // Konto o podanym e-mailu musi istnieć
    const [account] = await db
      .select({ id: user.id, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.email, body.email))
      .limit(1);
    if (!account) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono konta o tym adresie e-mail" },
        { status: 404 }
      );
    }

    // Podpinamy tylko konto z POTWIERDZONYM e-mailem (ta sama reguła co
    // src/lib/client-match.ts). Inaczej ktoś, kto założy konto na e-mail
    // przyszłego pracownika, dostałby po podpięciu dostęp do salonu. Błąd jest
    // jawny, bo właściciel musi wiedzieć, dlaczego podpięcie się nie udało.
    if (account.emailVerified !== true) {
      return NextResponse.json(
        {
          success: false,
          error:
            "To konto nie ma potwierdzonego adresu e-mail. Popros pracownika o potwierdzenie adresu (link z wiadomosci po rejestracji) i sprobuj ponownie.",
        },
        { status: 409 }
      );
    }

    // Konto może być podpięte pod najwyżej JEDNEGO pracownika
    // (w jakimkolwiek salonie); ponowne podpięcie tego samego pracownika jest OK.
    const [alreadyLinked] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.userId, account.id), ne(employees.id, id)))
      .limit(1);
    if (alreadyLinked) {
      return NextResponse.json(
        {
          success: false,
          error: "To konto jest juz przypisane do innego pracownika",
        },
        { status: 409 }
      );
    }

    // Właściciel salonu nie może być pracownikiem innego salonu
    const [ownedSalon] = await db
      .select({ id: salons.id })
      .from(salons)
      .where(eq(salons.ownerId, account.id))
      .limit(1);
    if (ownedSalon) {
      return NextResponse.json(
        {
          success: false,
          error: "Wlasciciel salonu nie moze byc pracownikiem innego salonu",
        },
        { status: 409 }
      );
    }

    const updated = await forSalon(salonId).updateOwned(employees, id, {
      userId: account.id,
    });
    logger.info(
      `[Employees API] Linked account ${account.id} to employee ${id}`
    );
    return NextResponse.json({ success: true, data: updated });
  }
);
