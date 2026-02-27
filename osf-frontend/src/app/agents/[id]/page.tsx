import { agents } from "@/lib/agents-data";
import { AgentDetailClient } from "./client";

export function generateStaticParams() {
  return [...agents.map((a) => ({ id: a.id })), { id: "placeholder" }];
}

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentDetailClient id={id} />;
}
