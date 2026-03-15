'use client';

import { ReactNode } from 'react';
import { ClusterProvider } from '../context/ClusterContext';
import { SSEProvider } from '../context/SSEContext';
import ClusterTabs from './ClusterTabs';

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <SSEProvider>
      <ClusterProvider>
        <ClusterTabs />
        <main className="p-4 bg-gray-50 dark:bg-gray-950 min-h-screen">{children}</main>
      </ClusterProvider>
    </SSEProvider>
  );
}
