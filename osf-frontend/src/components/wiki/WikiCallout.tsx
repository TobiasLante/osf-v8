interface WikiCalloutProps {
  type: "tip" | "warning" | "info";
  title?: string;
  children: React.ReactNode;
}

const styles = {
  tip: {
    border: "border-green-500/20",
    bg: "bg-green-500/5",
    icon: "text-green-400",
    label: "Tip",
    iconPath: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
  },
  warning: {
    border: "border-yellow-500/20",
    bg: "bg-yellow-500/5",
    icon: "text-yellow-400",
    label: "Warning",
    iconPath: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z",
  },
  info: {
    border: "border-blue-500/20",
    bg: "bg-blue-500/5",
    icon: "text-blue-400",
    label: "Info",
    iconPath: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
};

export function WikiCallout({ type, title, children }: WikiCalloutProps) {
  const s = styles[type];
  return (
    <div className={`rounded-md border ${s.border} ${s.bg} p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <svg
          className={`w-4 h-4 ${s.icon}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d={s.iconPath}
          />
        </svg>
        <span className={`text-xs font-semibold ${s.icon}`}>
          {title || s.label}
        </span>
      </div>
      <div className="text-sm text-text-muted leading-relaxed">{children}</div>
    </div>
  );
}
