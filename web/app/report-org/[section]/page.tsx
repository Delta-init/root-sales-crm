"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SectionView } from "@/components/report-org/SectionView";
import { sectionBySlug } from "@/components/report-org/data";

/** One section of the Report Org: executive, sales, finance, reconciliation or controls. */
export default function ReportOrgSectionPage() {
  const { section: slug } = useParams<{ section: string }>();
  const section = sectionBySlug(slug);

  if (!section) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm font-medium text-foreground">There is no such page in the Report Org</p>
        <Link href="/report-org/executive" className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline">
          Open the executive dashboard
        </Link>
      </div>
    );
  }

  // Keyed by section so an open report or a typed search does not carry over to the next one.
  return <SectionView key={section.slug} section={section} />;
}
