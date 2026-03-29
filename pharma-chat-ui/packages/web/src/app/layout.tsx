import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Process1st — Sales Intelligence for Bioprocess Equipment",
  description: "AI-powered pharma sales intelligence platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-p1-bg text-p1-text antialiased">
        {/* Top nav */}
        <header className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-p1-border bg-p1-bg/80 backdrop-blur-md flex items-center px-5 gap-4">
          <a href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
              P1
            </div>
            <span className="font-bold text-base tracking-tight">Process1st</span>
          </a>
          <span className="text-p1-dim text-xs hidden sm:inline">Sales Intelligence for Bioprocess Equipment</span>
          <div className="flex-1" />
          <a href="/settings" className="text-p1-muted hover:text-p1-text text-sm transition-colors">
            Settings
          </a>
        </header>
        <main className="pt-14">{children}</main>
      </body>
    </html>
  );
}
