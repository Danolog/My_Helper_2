import { legalPageMetadata, renderLegalPage } from "@/components/legal/legal-page";

export const metadata = legalPageMetadata("dpa");

export default function DpaPage() {
  return renderLegalPage("dpa");
}
