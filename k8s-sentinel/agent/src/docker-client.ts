import Dockerode from 'dockerode';
import { logger } from './logger';
import type { ClusterSnapshot, NodeInfo, PodInfo, ContainerStatusInfo } from './k8s-client';

export function createDockerClient(config: { socketPath?: string; host?: string; port?: number }): Dockerode {
  if (config.host) {
    return new Dockerode({ host: config.host, port: config.port || 2375 });
  }
  return new Dockerode({ socketPath: config.socketPath || '/var/run/docker.sock' });
}

export async function fetchDockerSnapshot(configOrSocket: string | { socketPath?: string; host?: string; port?: number }): Promise<ClusterSnapshot> {
  const docker = typeof configOrSocket === 'string'
    ? new Dockerode({ socketPath: configOrSocket })
    : createDockerClient(configOrSocket);

  const [containers, info] = await Promise.all([
    docker.listContainers({ all: true }),
    docker.info(),
  ]);

  const pods: PodInfo[] = await Promise.all(
    containers.map(async (c) => {
      const name = (c.Names?.[0] || c.Id).replace(/^\//, '');
      const isRunning = c.State === 'running';

      let restartCount = 0;
      let reason: string | undefined;
      let lastTerminationReason: string | undefined;

      try {
        const container = docker.getContainer(c.Id);
        const inspectData = await container.inspect();
        restartCount = inspectData.RestartCount || 0;

        if (!isRunning && inspectData.State?.OOMKilled) {
          reason = 'OOMKilled';
        } else if (c.State === 'exited') {
          reason = `Exited(${inspectData.State?.ExitCode ?? 0})`;
        } else if (c.State === 'restarting') {
          reason = 'Restarting';
        } else if (c.State === 'dead') {
          reason = 'Dead';
        }

        if (inspectData.State?.OOMKilled) {
          lastTerminationReason = 'OOMKilled';
        }
      } catch (err: any) {
        logger.warn({ err: err.message, container: name }, 'Failed to inspect container');
      }

      const phase = isRunning ? 'Running' :
                    c.State === 'exited' ? 'Failed' :
                    c.State === 'created' ? 'Pending' :
                    c.State === 'restarting' ? 'Running' :
                    c.State === 'paused' ? 'Running' :
                    c.State === 'dead' ? 'Failed' : 'Unknown';

      const containerStatus: ContainerStatusInfo = {
        name,
        ready: isRunning,
        restartCount,
        state: isRunning ? 'running' :
               c.State === 'exited' || c.State === 'dead' ? 'terminated' :
               'waiting',
        reason,
        lastTerminationReason,
      };

      return {
        name,
        namespace: 'docker',
        phase,
        ready: isRunning,
        restartCount,
        containerStatuses: [containerStatus],
        createdAt: c.Created ? new Date(c.Created * 1000).toISOString() : '',
        nodeName: 'docker-host',
      } satisfies PodInfo;
    })
  );

  const node: NodeInfo = {
    name: 'docker-host',
    ready: true,
    conditions: [{ type: 'Ready', status: 'True' }],
    capacity: {
      cpu: String(info.NCPU || 0),
      memory: info.MemTotal ? `${Math.round(info.MemTotal / 1024)}Ki` : undefined,
    },
    allocatable: {
      cpu: String(info.NCPU || 0),
      memory: info.MemTotal ? `${Math.round(info.MemTotal / 1024)}Ki` : undefined,
    },
  };

  const podsHealthy = pods.filter(p => p.ready && p.phase === 'Running').length;

  return {
    nodes: [node],
    namespaces: [{
      name: 'docker',
      podsTotal: pods.length,
      podsHealthy,
    }],
    pods,
    events: [],
    timestamp: new Date().toISOString(),
  };
}

export async function restartContainer(configOrSocket: string | { socketPath?: string; host?: string; port?: number }, containerId: string): Promise<void> {
  const docker = typeof configOrSocket === 'string'
    ? new Dockerode({ socketPath: configOrSocket })
    : createDockerClient(configOrSocket);
  const container = docker.getContainer(containerId);
  logger.info({ containerId }, 'Restarting Docker container');
  await container.restart();
}

export async function stopContainer(configOrSocket: string | { socketPath?: string; host?: string; port?: number }, containerId: string): Promise<void> {
  const docker = typeof configOrSocket === 'string'
    ? new Dockerode({ socketPath: configOrSocket })
    : createDockerClient(configOrSocket);
  const container = docker.getContainer(containerId);
  logger.info({ containerId }, 'Stopping Docker container');
  await container.stop();
}

export async function startContainer(configOrSocket: string | { socketPath?: string; host?: string; port?: number }, containerId: string): Promise<void> {
  const docker = typeof configOrSocket === 'string'
    ? new Dockerode({ socketPath: configOrSocket })
    : createDockerClient(configOrSocket);
  const container = docker.getContainer(containerId);
  logger.info({ containerId }, 'Starting Docker container');
  await container.start();
}

export async function removeContainer(configOrSocket: string | { socketPath?: string; host?: string; port?: number }, containerId: string): Promise<void> {
  const docker = typeof configOrSocket === 'string'
    ? new Dockerode({ socketPath: configOrSocket })
    : createDockerClient(configOrSocket);
  const container = docker.getContainer(containerId);
  logger.info({ containerId }, 'Removing Docker container');
  await container.remove({ force: true });
}
