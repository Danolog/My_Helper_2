import { legalPageMetadata, renderLegalPage } from "@/components/legal/legal-page";

export const metadata = legalPageMetadata("subprocessors");

export default function SubprocessorsPage() {
  return renderLegalPage("subprocessors");
}
