interface StatusDotProps {
  status: "online" | "offline" | "warning" | "error";
  size?: "sm" | "md";
  pulse?: boolean;
  className?: string;
}

const colorMap: Record<StatusDotProps["status"], string> = {
  online: "bg-green-400",
  offline: "bg-gray-500",
  warning: "bg-amber-400",
  error: "bg-red-400",
};

const sizeMap: Record<NonNullable<StatusDotProps["size"]>, string> = {
  sm: "w-2 h-2",
  md: "w-3 h-3",
};

export function StatusDot({
  status,
  size = "sm",
  pulse,
  className = "",
}: StatusDotProps) {
  return (
    <span
      className={`inline-block rounded-full ${sizeMap[size]} ${colorMap[status]} ${
        pulse ? "animate-pulse" : ""
      } ${className}`}
    />
  );
}
