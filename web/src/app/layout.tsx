import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import ThemeToggle from './components/ThemeToggle';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'OSF v9 — Knowledge Graph Platform',
  description: 'Knowledge Graph Builder for Open Shop Floor v9',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <nav className="border-b border-[var(--border)] bg-[var(--card)]">
          <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-3">
            <div>
              <h1 className="text-lg font-bold tracking-tight">OSF v9</h1>
              <p className="text-xs text-[var(--muted)]">Knowledge Graph Platform</p>
            </div>
            <ThemeToggle />
          </div>
        </nav>
        <main className="px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
