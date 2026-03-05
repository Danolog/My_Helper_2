CREATE INDEX "appointments_salon_status_start_idx" ON "appointments" USING btree ("salon_id","status","start_time");--> statement-breakpoint
CREATE INDEX "appointments_employee_status_start_idx" ON "appointments" USING btree ("employee_id","status","start_time");--> statement-breakpoint
CREATE INDEX "appointments_booked_by_user_id_idx" ON "appointments" USING btree ("booked_by_user_id");--> statement-breakpoint
CREATE INDEX "appointments_service_id_idx" ON "appointments" USING btree ("service_id");