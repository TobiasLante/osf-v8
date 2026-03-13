import { getAllSlugs } from "@/lib/wiki-data";
import { WikiPageClient } from "./client";

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export default function WikiPage({ params }: { params: { slug: string } }) {
  return <WikiPageClient slug={params.slug} />;
}
