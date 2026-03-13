import CodeAgentDetailClient from './client';

export function generateStaticParams() {
  return [{ id: 'placeholder' }];
}

export default function CodeAgentDetailPage({ params }: { params: { id: string } }) {
  return <CodeAgentDetailClient id={params.id} />;
}
