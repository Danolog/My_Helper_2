import { legalPageMetadata, renderLegalPage } from "@/components/legal/legal-page";

export const metadata = legalPageMetadata("contact");

export default function ContactPage() {
  return renderLegalPage("contact");
}
