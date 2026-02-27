import { FlowDetailClient } from "./client";

// Static export requires generateStaticParams — we return a placeholder.
// Actual flow IDs are resolved client-side. Cloudflare Pages SPA fallback handles unknown paths.
export function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default async function FlowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FlowDetailClient id={id} />;
}
