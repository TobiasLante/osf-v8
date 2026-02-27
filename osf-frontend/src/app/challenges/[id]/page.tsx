import { challenges } from "@/lib/challenges-data";
import { ChallengeDetailClient } from "./client";

export function generateStaticParams() {
  return challenges.map((c) => ({ id: c.id }));
}

export default async function ChallengeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChallengeDetailClient id={id} />;
}
