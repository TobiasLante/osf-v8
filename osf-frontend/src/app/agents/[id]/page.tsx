import { agents } from "@/lib/agents-data";
import { AgentDetailClient } from "./client";

export function generateStaticParams() {
  return [...agents.map((a) => ({ id: a.id })), { id: "placeholder" }];
}

export default function AgentDetailPage({ params }: { params: { id: string } }) {
  return <AgentDetailClient id={params.id} />;
}
