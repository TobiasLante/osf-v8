import CodeAgentDetailClient from './client';

export function generateStaticParams() {
  return [{ id: 'placeholder' }];
}

export default async function CodeAgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CodeAgentDetailClient id={id} />;
}
