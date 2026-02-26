import { logger } from '../logger';

interface NodeStatus {
  fill: 'red' | 'green' | 'yellow' | 'blue' | 'grey';
  shape: 'ring' | 'dot';
  text: string;
}

let events: any = null;
let initAttempted = false;

function getEvents(): any {
  if (!initAttempted) {
    initAttempted = true;
    try {
      events = require('@node-red/util').events;
    } catch {
      logger.warn('Could not load @node-red/util — node status dots disabled');
    }
  }
  return events;
}

export function setNodeStatus(nodeId: string, status: NodeStatus): void {
  const ev = getEvents();
  if (ev) {
    ev.emit('node-status', { id: nodeId, status });
  }
}

export function clearNodeStatus(nodeId: string): void {
  const ev = getEvents();
  if (ev) {
    ev.emit('node-status', { id: nodeId });
  }
}
