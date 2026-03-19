import { generateText } from "ai";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import {
  createAIClient,
  getAIModel,
  requireProAI,
  isProAIError,
  getSalonContext,
  trackAIUsage,
} from "@/lib/ai/openrouter";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  appointments,
  clients,
  employees,
  services,
  treatmentHistory,
  appointmentMaterials,
  products,
} from "@/lib/schema";

const requestSchema = z.object({
  appointmentId: z.string().uuid("Nieprawidlowy format ID wizyty"),
});

export async function POST(req: Request) {
  // Combined auth + salon + Pro plan check
  const proResult = await requireProAI();
  if (isProAIError(proResult)) return proResult;
  const { salonId } = proResult;

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { appointmentId } = parsed.data;

  try {
    // Fetch appointment with related data (client, employee, service)
    const [appointmentData] = await db
      .select({
        appointment: appointments,
        client: clients,
        employee: employees,
        service: services,
      })
      .from(appointments)
      .leftJoin(clients, eq(appointments.clientId, clients.id))
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(
        and(
          eq(appointments.id, appointmentId),
          eq(appointments.salonId, salonId),
        ),
      )
      .limit(1);

    if (!appointmentData) {
      return Response.json(
        { error: "Wizyta nie zostala znaleziona" },
        { status: 404 },
      );
    }

    // Fetch treatment history for this appointment
    const treatments = await db
      .select()
      .from(treatmentHistory)
      .where(eq(treatmentHistory.appointmentId, appointmentId));

    // Fetch materials used during this appointment (with product names)
    const materials = await db
      .select({
        quantityUsed: appointmentMaterials.quantityUsed,
        notes: appointmentMaterials.notes,
        productName: products.name,
        productUnit: products.unit,
      })
      .from(appointmentMaterials)
      .leftJoin(products, eq(appointmentMaterials.productId, products.id))
      .where(eq(appointmentMaterials.appointmentId, appointmentId));

    // Fetch client's previous completed appointments (last 5) for context
    let previousAppointments: Array<{
      serviceName: string | null;
      startTime: Date;
      notes: string | null;
    }> = [];
    if (appointmentData.client) {
      previousAppointments = await db
        .select({
          serviceName: services.name,
          startTime: appointments.startTime,
          notes: appointments.notes,
        })
        .from(appointments)
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.clientId, appointmentData.client.id),
            eq(appointments.salonId, salonId),
            eq(appointments.status, "completed"),
          ),
        )
        .orderBy(desc(appointments.startTime))
        .limit(5);
    }

    const { salonName, industryLabel } = await getSalonContext(salonId);

    // Build context string for the AI prompt
    const contextParts: string[] = [];
    contextParts.push(`Salon: "${salonName}" (${industryLabel})`);
    contextParts.push(
      `Usluga: ${appointmentData.service?.name || "Nieznana"} (${appointmentData.service?.basePrice || "?"} PLN, ${appointmentData.service?.baseDuration || "?"} min)`,
    );

    if (appointmentData.employee) {
      contextParts.push(
        `Pracownik: ${appointmentData.employee.firstName} ${appointmentData.employee.lastName}`,
      );
    }
    if (appointmentData.client) {
      contextParts.push(
        `Klient: ${appointmentData.client.firstName} ${appointmentData.client.lastName}`,
      );
      if (appointmentData.client.allergies) {
        contextParts.push(
          `Alergie klienta: ${appointmentData.client.allergies}`,
        );
      }
      if (appointmentData.client.preferences) {
        contextParts.push(
          `Preferencje klienta: ${appointmentData.client.preferences}`,
        );
      }
    }
    if (appointmentData.appointment.notes) {
      contextParts.push(
        `Notatki z wizyty: ${appointmentData.appointment.notes}`,
      );
    }

    if (treatments.length > 0) {
      const treatmentInfo = treatments
        .map((t) => {
          const parts: string[] = [];
          if (t.recipe) parts.push(`Receptura: ${t.recipe}`);
          if (t.techniques) parts.push(`Techniki: ${t.techniques}`);
          if (t.notes) parts.push(`Notatki: ${t.notes}`);
          return parts.join("; ");
        })
        .join("\n");
      contextParts.push(`Historia zabiegu:\n${treatmentInfo}`);
    }

    if (materials.length > 0) {
      const materialsInfo = materials
        .map(
          (m) =>
            `${m.productName || "Nieznany"}: ${m.quantityUsed} ${m.productUnit || "szt."}${m.notes ? ` (${m.notes})` : ""}`,
        )
        .join(", ");
      contextParts.push(`Uzyte materialy: ${materialsInfo}`);
    }

    if (previousAppointments.length > 0) {
      const historyInfo = previousAppointments
        .map(
          (a) =>
            `${a.startTime.toLocaleDateString("pl-PL")}: ${a.serviceName || "?"}${a.notes ? ` - ${a.notes}` : ""}`,
        )
        .join("\n");
      contextParts.push(`Poprzednie wizyty klienta:\n${historyInfo}`);
    }

    const systemPrompt = `Jestes asystentem salonu "${salonName}" (${industryLabel}). Twoje zadanie to wygenerowac ustrukturyzowane podsumowanie wizyty na podstawie dostarczonych danych.

Zwroc odpowiedz w formacie JSON (i TYLKO JSON, bez dodatkowego tekstu):
{
  "keyPoints": ["punkt 1", "punkt 2", ...],
  "productRecommendations": ["rekomendacja 1", ...],
  "followUpTiming": "za X tygodni/dni - uzasadnienie",
  "fullSummary": "pelne podsumowanie w 3-5 zdaniach"
}

Zasady:
- Pisz TYLKO po polsku
- keyPoints: 3-5 kluczowych punktow z zabiegu (co zrobiono, jakie produkty, jakie techniki)
- productRecommendations: 1-3 produkty do domowej pielegnacji lub do nastepnej wizyty (bazuj na zabiegu i materialach)
- followUpTiming: sugerowany termin nastepnej wizyty z uzasadnieniem
- fullSummary: zwiezle podsumowanie calej wizyty
- Bazuj TYLKO na dostarczonych danych, nie wymyslaj
- Jezeli brakuje danych na dany punkt, wpisz "Brak danych"`;

    const openrouter = createAIClient();
    const result = await generateText({
      model: openrouter(getAIModel()),
      system: systemPrompt,
      prompt: contextParts.join("\n\n"),
      maxOutputTokens: 1000,
    });

    const responseText = result.text.trim();

    // Parse JSON response from AI, with fallback for malformed output
    let summary;
    try {
      // Extract JSON even if AI wraps it in markdown code blocks
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in AI response");
      summary = JSON.parse(jsonMatch[0]);
    } catch {
      logger.warn("[AI Appointments] Failed to parse AI summary as JSON", {
        responseText,
      });
      summary = {
        keyPoints: [responseText],
        productRecommendations: [],
        followUpTiming: "Brak danych",
        fullSummary: responseText,
      };
    }

    void trackAIUsage(salonId, "auto_summary");

    return Response.json({ success: true, summary });
  } catch (error) {
    logger.error("[AI Appointments] Error generating auto-summary", { error });
    return Response.json(
      { error: "Blad podczas generowania podsumowania. Sprobuj ponownie." },
      { status: 500 },
    );
  }
}
