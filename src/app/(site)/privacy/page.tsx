import { legalPageMetadata, renderLegalPage } from "@/components/legal/legal-page";

export const metadata = legalPageMetadata("privacy");

export default function PrivacyPage() {
  return renderLegalPage("privacy");
}
