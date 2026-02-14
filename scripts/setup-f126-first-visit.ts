/**
 * Setup script for Feature #126: First visit discount
 * Creates a first_visit promotion for the demo salon
 */

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";
const BASE_URL = "http://localhost:3000";

async function main() {
  console.log("=== Feature #126: Setting up first visit promotion ===\n");

  // Create first_visit promotion
  const promoRes = await fetch(`${BASE_URL}/api/promotions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      salonId: DEMO_SALON_ID,
      name: "Znizka na pierwsza wizyte -15%",
      type: "first_visit",
      value: "15",
      isActive: true,
    }),
  });

  const promoData = await promoRes.json();
  if (promoData.success) {
    console.log("Created first_visit promotion:", promoData.data.id);
    console.log("  Name:", promoData.data.name);
    console.log("  Type:", promoData.data.type);
    console.log("  Value:", promoData.data.value, "%");
  } else {
    console.error("Failed to create promotion:", promoData.error);
  }

  console.log("\n=== Setup complete ===");
  console.log("Next steps:");
  console.log("1. Register as a brand new user (e.g., feature126@test.com)");
  console.log("2. Go to booking page for the salon");
  console.log("3. Select a service and complete booking steps");
  console.log("4. Verify that the first visit discount (15%) is shown");
  console.log("5. Complete booking");
  console.log("6. Try booking again - discount should NOT appear for 2nd visit");
}

main().catch(console.error);
