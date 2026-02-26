interface WikiSectionProps {
  title: string;
  id?: string;
  children: React.ReactNode;
}

export function WikiSection({ title, id, children }: WikiSectionProps) {
  return (
    <div id={id} className="border border-border rounded-md p-6 bg-bg-surface scroll-mt-24">
      <h2 className="text-xl font-bold mb-4">{title}</h2>
      <div className="text-sm text-text-muted leading-relaxed space-y-3">
        {children}
      </div>
    </div>
  );
}
