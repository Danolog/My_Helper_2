import { legalPageMetadata, renderLegalPage } from "@/components/legal/legal-page";

export const metadata = legalPageMetadata("terms");

export default function TermsPage() {
  return renderLegalPage("terms");
}
