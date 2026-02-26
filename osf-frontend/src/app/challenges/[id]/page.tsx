import { challenges } from "@/lib/challenges-data";
import { ChallengeDetailClient } from "./client";

export function generateStaticParams() {
  return challenges.map((c) => ({ id: c.id }));
}

export default function ChallengeDetailPage({ params }: { params: { id: string } }) {
  return <ChallengeDetailClient id={params.id} />;
}
