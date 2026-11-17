-- T3b: jeden bieżący wiersz subskrypcji na salon i jeden salon na konto.
-- Wygenerowane przez `pnpm db:generate`; kolejność zmieniona ręcznie: najpierw
-- nowy indeks unikalny, potem usunięcie starego (bez chwili bez indeksu).
--
-- Przed zastosowaniem na produkcji (zgoda właściciela) sprawdzić, czy nie ma kolizji.
-- Oba zapytania muszą zwrócić 0 wierszy:
--   SELECT salon_id FROM salon_subscriptions WHERE status IN ('trialing','active')
--     GROUP BY salon_id HAVING count(*) > 1;
--   SELECT owner_id FROM salons WHERE owner_id IS NOT NULL
--     GROUP BY owner_id HAVING count(*) > 1;
--
-- ROLLBACK:
--   CREATE INDEX "salons_owner_id_idx" ON "salons" USING btree ("owner_id");
--   DROP INDEX "salons_owner_id_uq";
--   DROP INDEX "salon_subscriptions_salon_current_uq";
CREATE UNIQUE INDEX "salon_subscriptions_salon_current_uq" ON "salon_subscriptions" USING btree ("salon_id") WHERE "salon_subscriptions"."status" in ('trialing', 'active');--> statement-breakpoint
CREATE UNIQUE INDEX "salons_owner_id_uq" ON "salons" USING btree ("owner_id");--> statement-breakpoint
DROP INDEX "salons_owner_id_idx";
