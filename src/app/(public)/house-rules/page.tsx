import type { Metadata } from "next";
import StaticDocument from "@/components/legal/StaticDocument";
import { houseRules } from "@/strings/houseRules";

export const metadata: Metadata = { title: houseRules.title };

export default function HouseRulesPage() {
  return (
    <StaticDocument
      title={houseRules.title}
      intro={houseRules.intro}
      sections={houseRules.sections}
    />
  );
}
