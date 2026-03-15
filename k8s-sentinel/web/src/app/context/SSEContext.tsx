'use client';

import { createContext, useContext, useEffect, useRef, useCallback, ReactNode } from 'react';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:8888';

type SSECallback = (data: any) => void;

interface SSEContextType {
  subscribe: (event: string, callback: SSECallback) => () => void;
}

const SSEContext = createContext<SSEContextType>({
  subscribe: () => () => {},
});

export function SSEProvider({ children }: { children: ReactNode }) {
  const listenersRef = useRef<Map<string, Set<SSECallback>>>(new Map());
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`${AGENT_URL}/api/stream`);
    esRef.current = es;

    // Generic message handler that dispatches to subscribers
    const knownEvents = [
      'check_start', 'check_complete', 'cluster_status',
      'issue_detected', 'fix_proposed', 'fix_applied', 'fix_rejected',
      'mode_changed', 'cluster_added', 'cluster_removed',
      'prediction', 'prediction_expired',
      'runbook_started', 'runbook_step', 'runbook_completed',
      'tool_approval_required', 'tool_approved', 'tool_rejected',
      'heartbeat',
    ];

    for (const eventName of knownEvents) {
      es.addEventListener(eventName, (e: MessageEvent) => {
        let data: any;
        try { data = JSON.parse(e.data); } catch { data = e.data; }
        const callbacks = listenersRef.current.get(eventName);
        if (callbacks) {
          callbacks.forEach(cb => {
            try { cb(data); } catch {}
          });
        }
      });
    }

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  const subscribe = useCallback((event: string, callback: SSECallback): (() => void) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(callback);

    return () => {
      listenersRef.current.get(event)?.delete(callback);
    };
  }, []);

  return (
    <SSEContext.Provider value={{ subscribe }}>
      {children}
    </SSEContext.Provider>
  );
}

export function useSSE(event: string, callback: SSECallback) {
  const { subscribe } = useContext(SSEContext);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    return subscribe(event, (data) => callbackRef.current(data));
  }, [subscribe, event]);
}

export function useSSEEvents(events: string[], callback: SSECallback) {
  const { subscribe } = useContext(SSEContext);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const unsubs = events.map(event =>
      subscribe(event, (data) => callbackRef.current(data))
    );
    return () => unsubs.forEach(u => u());
  }, [subscribe, events.join(',')]);
}
