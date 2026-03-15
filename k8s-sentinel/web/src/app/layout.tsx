import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import ThemeToggle from './components/ThemeToggle';
import ModeSelector from './components/ModeSelector';
import AppShell from './components/AppShell';
import NavSettings from './components/NavSettings';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'k8s-sentinel',
  description: 'AI-powered Kubernetes Cluster Monitor',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <nav className="border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex items-center gap-4 bg-white dark:bg-gray-950">
          <h1 className="text-lg font-bold text-emerald-600 dark:text-emerald-400">k8s-sentinel</h1>
          <span className="text-xs text-gray-400 dark:text-gray-500">AI-powered K8s Monitor</span>
          <div className="ml-auto flex items-center gap-3">
            <ModeSelector />
            <NavSettings />
            <ThemeToggle />
          </div>
        </nav>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
