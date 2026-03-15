'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:8888';

export interface Cluster {
  id: string;
  name: string;
  type: 'k8s' | 'docker';
  config: any;
  enabled: boolean;
}

interface ClusterContextType {
  clusters: Cluster[];
  activeClusterId: string | null;
  activeCluster: Cluster | null;
  setActiveClusterId: (id: string) => void;
  refreshClusters: () => void;
}

const ClusterContext = createContext<ClusterContextType>({
  clusters: [],
  activeClusterId: null,
  activeCluster: null,
  setActiveClusterId: () => {},
  refreshClusters: () => {},
});

export function ClusterProvider({ children }: { children: ReactNode }) {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);

  const fetchClusters = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT_URL}/api/clusters`);
      const data: Cluster[] = await res.json();
      setClusters(data);
      // Set first cluster as active if none selected or current selection no longer exists
      if (data.length > 0 && (!activeClusterId || !data.find(c => c.id === activeClusterId))) {
        setActiveClusterId(data[0].id);
      }
    } catch {}
  }, [activeClusterId]);

  useEffect(() => {
    fetchClusters();

    const es = new EventSource(`${AGENT_URL}/api/stream`);
    es.addEventListener('cluster_added', () => fetchClusters());
    es.addEventListener('cluster_removed', () => fetchClusters());
    return () => es.close();
  }, []);

  const activeCluster = clusters.find(c => c.id === activeClusterId) || null;

  return (
    <ClusterContext.Provider
      value={{
        clusters,
        activeClusterId,
        activeCluster,
        setActiveClusterId,
        refreshClusters: fetchClusters,
      }}
    >
      {children}
    </ClusterContext.Provider>
  );
}

export function useCluster() {
  return useContext(ClusterContext);
}
