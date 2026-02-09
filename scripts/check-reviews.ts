import { db } from "../src/lib/db";
import { reviews } from "../src/lib/schema";
import { desc } from "drizzle-orm";

async function main() {
  const allReviews = await db.select().from(reviews).orderBy(desc(reviews.createdAt)).limit(10);

  console.log("Total reviews found: " + allReviews.length);
  for (const r of allReviews) {
    console.log("---");
    console.log("  ID: " + r.id);
    console.log("  AppointmentID: " + r.appointmentId);
    console.log("  Rating: " + r.rating);
    console.log("  Comment: " + (r.comment ? r.comment.substring(0, 50) : "null"));
    console.log("  Status: " + r.status);
    console.log("  Created: " + r.createdAt);
  }

  process.exit(0);
}

main().catch(console.error);
