import type { Metadata } from "next";
import StaticDocument from "@/components/legal/StaticDocument";
import { privacy } from "@/strings/privacy";

export const metadata: Metadata = { title: privacy.title };

export default function PrivacyPage() {
  return (
    <StaticDocument
      title={privacy.title}
      intro={privacy.intro}
      sections={privacy.sections}
    />
  );
}
