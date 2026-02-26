import { ReactNode } from "react";

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
  padding?: "sm" | "md" | "lg";
}

const paddingMap: Record<NonNullable<CardProps["padding"]>, string> = {
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export function Card({
  title,
  children,
  className = "",
  padding = "lg",
}: CardProps) {
  return (
    <div
      className={`bg-bg-surface border border-border rounded-md ${paddingMap[padding]} ${className}`}
    >
      {title && (
        <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-4">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}
