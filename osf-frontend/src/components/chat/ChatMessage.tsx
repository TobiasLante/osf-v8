"use client";

import { ToolCallCard } from "./ToolCallCard";
import { safeMarkdown } from "@/lib/markdown";

interface ToolCallData {
  name: string;
  arguments?: Record<string, any>;
  result?: string;
  status?: "running" | "done" | "error";
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallData[];
  time?: string;
}

export function ChatMessage({ role, content, toolCalls, time }: ChatMessageProps) {
  const isUser = role === "user";
  const timeStr = time || new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className={`flex gap-3.5 max-w-[900px] animate-slide-up ${
        isUser ? "flex-row-reverse ml-auto" : ""
      }`}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-9 h-9 rounded-[10px] grid place-items-center text-base ${
          isUser
            ? "bg-bg-surface-3 border border-border"
            : "bg-accent-gradient"
        }`}
      >
        {isUser ? "👤" : "⚡"}
      </div>

      <div className="flex-1 min-w-0">
        {/* Meta */}
        <div className={`flex items-center gap-2.5 mb-1.5 ${isUser ? "justify-end" : ""}`}>
          <span className="font-semibold text-[13px]">
            {isUser ? "You" : "OpenShopFloor AI"}
          </span>
          <span className="text-[11px] text-text-dim">{timeStr}</span>
        </div>

        {/* Tool calls */}
        {toolCalls && toolCalls.length > 0 && (
          <div className="mb-2 space-y-1.5">
            {toolCalls.map((tc, i) => (
              <ToolCallCard
                key={i}
                name={tc.name}
                arguments={tc.arguments}
                result={tc.result}
                status={tc.status || "done"}
              />
            ))}
          </div>
        )}

        {/* Content */}
        {content && (
          <div
            className={`px-5 py-4 rounded-md leading-[1.7] text-sm ${
              isUser
                ? "bg-accent/[0.08] border border-accent/[0.15] rounded-tr-[4px]"
                : "bg-bg-surface border border-border rounded-tl-[4px]"
            } [&_h1]:text-[1.3rem] [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1:first-child]:mt-0
              [&_h2]:text-[1.15rem] [&_h2]:font-bold [&_h2]:text-accent [&_h2]:mt-4 [&_h2]:mb-2 [&_h2:first-child]:mt-0
              [&_h3]:text-base [&_h3]:font-bold [&_h3]:mt-3 [&_h3]:mb-1.5
              [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0
              [&_code]:font-mono [&_code]:bg-accent/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.85em] [&_code]:text-accent
              [&_pre]:bg-bg [&_pre]:border [&_pre]:border-border [&_pre]:rounded-sm [&_pre]:p-3.5 [&_pre]:my-3 [&_pre]:overflow-x-auto
              [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-text
              [&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_table]:text-[13px]
              [&_th]:p-2 [&_th]:px-3 [&_th]:text-left [&_th]:border-b [&_th]:border-border [&_th]:font-semibold [&_th]:text-text-muted [&_th]:bg-bg-surface-2
              [&_td]:p-2 [&_td]:px-3 [&_td]:text-left [&_td]:border-b [&_td]:border-border
              [&_ul]:my-2 [&_ul]:pl-5 [&_li]:my-1
              [&_strong]:text-text [&_strong]:font-semibold
              [&_a]:text-accent [&_a]:no-underline [&_a]:border-b [&_a]:border-accent/30 hover:[&_a]:text-text hover:[&_a]:border-accent`}
            dangerouslySetInnerHTML={{ __html: safeMarkdown(content) }}
          />
        )}
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex gap-3.5 max-w-[900px] animate-slide-up">
      <div className="flex-shrink-0 w-9 h-9 rounded-[10px] grid place-items-center text-base bg-accent-gradient">
        ⚡
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-1.5 px-5 py-4">
          <div className="w-[7px] h-[7px] rounded-full bg-accent animate-bounce [animation-delay:0ms]" />
          <div className="w-[7px] h-[7px] rounded-full bg-accent animate-bounce [animation-delay:200ms]" />
          <div className="w-[7px] h-[7px] rounded-full bg-accent animate-bounce [animation-delay:400ms]" />
        </div>
      </div>
    </div>
  );
}
