import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { linkEmployeeAccountSchema } from "@/lib/api-validation";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { employees } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
// #193: konto po e-mailu (tabela Better Auth `user`) i reguły obejmujące wszystkie
// salony — wyjście systemowe zwracające wyłącznie flagi.
import { findAccountForEmployeeLink } from "@/lib/server/system";
import { revokeSalonGrantsForUser } from "@/lib/temporary-access";
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
  async ({ body, params, auth }) => {
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

    // Granty czasowe nadane przez właściciela TEGO salonu odpinanemu kontu
    // kasujemy przed zmianą powiązania (fail-closed: jeśli zmiana się nie
    // uda, konto zostaje bez grantów, a nie z grantem bez pracownika).
    // getUserSalonId => wołający jest właścicielem (salons.ownerId).
    const revokeGrantsOf = async (previousUserId: string) => {
      const revoked = await revokeSalonGrantsForUser(previousUserId, auth!.user.id);
      if (revoked > 0) {
        logger.info(
          `[Employees API] Revoked ${revoked} temporary access grant(s) of unlinked account on employee ${id}`
        );
      }
    };

    // email = null => odłączenie konta od pracownika
    if (body.email === null) {
      if (employee.userId) await revokeGrantsOf(employee.userId);
      const updated = await forSalon(salonId).updateOwned(employees, id, {
        userId: null,
      });
      logger.info(`[Employees API] Unlinked account from employee ${id}`);
      return NextResponse.json({ success: true, data: updated });
    }

    // Konto o podanym e-mailu musi istnieć
    const account = await findAccountForEmployeeLink(body.email, id);
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
    if (account.linkedElsewhere) {
      return NextResponse.json(
        {
          success: false,
          error: "To konto jest juz przypisane do innego pracownika",
        },
        { status: 409 }
      );
    }

    // Właściciel salonu nie może być pracownikiem innego salonu
    if (account.ownsSalon) {
      return NextResponse.json(
        {
          success: false,
          error: "Wlasciciel salonu nie moze byc pracownikiem innego salonu",
        },
        { status: 409 }
      );
    }

    // Przepięcie na inne konto = odpięcie poprzedniego
    if (employee.userId && employee.userId !== account.id) {
      await revokeGrantsOf(employee.userId);
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
