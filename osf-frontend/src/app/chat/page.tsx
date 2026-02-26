"use client";

import { Suspense } from "react";
import { ChatPageContent } from "./content";

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center">
        <p className="text-text-muted">Loading...</p>
      </div>
    }>
      <ChatPageContent />
    </Suspense>
  );
}
