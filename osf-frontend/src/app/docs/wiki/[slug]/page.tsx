import { getAllSlugs } from "@/lib/wiki-data";
import { WikiPageClient } from "./client";

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export default async function WikiPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <WikiPageClient slug={slug} />;
}
