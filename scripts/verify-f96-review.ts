import { db } from "../src/lib/db";
import { reviews } from "../src/lib/schema";
import { eq } from "drizzle-orm";

async function main() {
  const appointmentId = "27fc7d2b-9209-4baf-99e8-69b8352fc9d3";

  const reviewList = await db.select().from(reviews).where(eq(reviews.appointmentId, appointmentId)).limit(1);

  if (!reviewList[0]) {
    console.log("NO REVIEW FOUND for appointment " + appointmentId);
    process.exit(1);
  }

  const review = reviewList[0];
  console.log("REVIEW FOUND:");
  console.log("  ID: " + review.id);
  console.log("  Rating: " + review.rating);
  console.log("  Comment: " + review.comment);
  console.log("  Status: " + review.status);
  console.log("  Created: " + review.createdAt);
  console.log("  Rating is null: " + (review.rating === null));
  console.log("  Comment has text: " + (review.comment !== null && review.comment.length > 0));

  if (review.rating === null && review.comment && review.comment.includes("TEST_F96_TEXTONLY")) {
    console.log("VERIFICATION PASSED: Text-only review with no rating stored in database!");
  } else {
    console.log("VERIFICATION FAILED");
  }

  process.exit(0);
}

main().catch(console.error);
