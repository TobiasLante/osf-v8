import { ChainDetailClient } from "./client";

// Pre-render the 3 featured chain IDs; community chains use fallback
export function generateStaticParams() {
  return [
    { id: "factory-health-check" },
    { id: "delivery-risk-pipeline" },
    { id: "nightly-review" },
    { id: "placeholder" },
  ];
}

export default async function ChainDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChainDetailClient id={id} />;
}
