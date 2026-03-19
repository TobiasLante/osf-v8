import Link from "next/link";
import { WikiSection } from "@/components/wiki/WikiSection";
import { WikiCallout } from "@/components/wiki/WikiCallout";

export function HistorianContent() {
  return (
    <>
      <WikiSection title="Overview">
        <p>
          The Historian provides an industrial-grade MQTT-to-TimescaleDB
          time-series pipeline. It subscribes to MQTT topics on the Unified
          Namespace (UNS), automatically creates hypertables, and stores data with
          configurable retention policies, downsampling, and crash recovery.
        </p>
      </WikiSection>

      <WikiSection title="Architecture">
        <div className="mt-4 rounded-md border border-border bg-[#0d1117] p-4 font-mono text-xs text-gray-300 leading-relaxed">
          <div className="text-text-dim mb-2">{"// Historian Pipeline"}</div>
          <div>
            <span className="text-blue-400">MQTT Broker</span> (UNS Topics)
          </div>
          <div className="text-text-dim">{"    │"}</div>
          <div className="text-text-dim">{"    ├── Topic Profiles (routing rules)"}</div>
          <div className="text-text-dim">{"    ▼"}</div>
          <div>
            <span className="text-green-400">Historian Service</span>
          </div>
          <div className="text-text-dim">{"    │"}</div>
          <div className="text-text-dim">{"    ├── Disk Buffer (crash recovery)"}</div>
          <div className="text-text-dim">{"    ├── Backpressure control"}</div>
          <div className="text-text-dim">{"    ├── COPY protocol (bulk insert)"}</div>
          <div className="text-text-dim">{"    ▼"}</div>
          <div>
            <span className="text-orange-400">TimescaleDB</span> (PostgreSQL)
          </div>
          <div className="text-text-dim">{"    │"}</div>
          <div className="text-text-dim">{"    ├── Hypertables (auto-created)"}</div>
          <div className="text-text-dim">{"    ├── Retention policies"}</div>
          <div className="text-text-dim">{"    └── Continuous aggregates (downsampling)"}</div>
        </div>
      </WikiSection>

      <WikiSection title="Features">
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Auto Table Creation</strong> &mdash; Hypertables are created
            automatically when new MQTT topics are first seen
          </li>
          <li>
            <strong>Retention Policies</strong> &mdash; Configurable per-table data
            retention (e.g., 90 days raw, 1 year aggregated)
          </li>
          <li>
            <strong>Downsampling</strong> &mdash; Continuous aggregates for 1-minute,
            1-hour, and 1-day rollups
          </li>
          <li>
            <strong>Disk Buffer</strong> &mdash; Writes to local disk when the database
            is unreachable, replays on reconnect
          </li>
          <li>
            <strong>Backpressure</strong> &mdash; Throttles ingestion when the database
            falls behind to prevent memory exhaustion
          </li>
          <li>
            <strong>COPY Protocol</strong> &mdash; Uses PostgreSQL COPY for bulk inserts,
            significantly faster than row-by-row INSERT
          </li>
          <li>
            <strong>Dead-Letter Queue</strong> &mdash; Messages that fail 3 retries are
            moved to a dead-letter topic for investigation
          </li>
        </ul>
      </WikiSection>

      <WikiSection title="MCP Tools (6 History Tools)">
        <p>
          The Historian exposes 6 tools via MCP for LLM-driven time-series analysis:
        </p>
        <div className="mt-3 space-y-3">
          {[
            ["history_get_trend", "Retrieve time-series data for a variable over a time range with optional downsampling"],
            ["history_compare", "Compare trends of multiple variables side-by-side over the same time window"],
            ["history_aggregate", "Compute aggregations (min, max, avg, sum, count) over configurable time buckets"],
            ["history_anomalies", "Detect anomalies using statistical methods (z-score, IQR) on historical data"],
            ["history_machines", "List all machines with historian data, including variable counts and time ranges"],
            ["history_variables", "List all recorded variables for a machine with metadata (type, unit, sample count)"],
          ].map(([tool, desc]) => (
            <div key={tool} className="p-3 rounded border border-border bg-bg-surface-2">
              <code className="text-accent text-xs font-mono">{tool}</code>
              <p className="mt-1 text-sm">{desc}</p>
            </div>
          ))}
        </div>
      </WikiSection>

      <WikiSection title="Topic Profiles">
        <p>
          Topic profiles define how MQTT topics are routed to TimescaleDB tables.
          Each profile specifies:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Topic Pattern</strong> &mdash; MQTT topic filter (supports wildcards)
          </li>
          <li>
            <strong>Target Table</strong> &mdash; TimescaleDB hypertable name
          </li>
          <li>
            <strong>Field Mapping</strong> &mdash; JSON path to extract timestamp, value,
            and tags
          </li>
          <li>
            <strong>Retention</strong> &mdash; Per-profile data retention period
          </li>
        </ul>
        <div className="mt-3 rounded-md border border-border bg-[#0d1117] p-4 font-mono text-xs text-gray-300 leading-relaxed">
          <div className="text-text-dim">{"// Example topic profile"}</div>
          <div>{"{"}</div>
          <div>{"  topic: 'uns/bz-1/cnc/+/temperature',"}</div>
          <div>{"  table: 'bde_data',"}</div>
          <div>{"  fields: { ts: '$.timestamp', value: '$.value' },"}</div>
          <div>{"  retention: '90d'"}</div>
          <div>{"}"}</div>
        </div>
      </WikiSection>

      <WikiSection title="REST API">
        <p>
          The Historian exposes a REST API for management and data exploration:
        </p>
        <div className="mt-3 space-y-3">
          <div className="p-3 rounded border border-border bg-bg-surface-2">
            <code className="text-accent text-xs font-mono">Route Management</code>
            <p className="mt-1 text-sm">
              Create, update, and delete MQTT topic subscriptions and routing rules.
            </p>
          </div>
          <div className="p-3 rounded border border-border bg-bg-surface-2">
            <code className="text-accent text-xs font-mono">Profile Management</code>
            <p className="mt-1 text-sm">
              Configure topic profiles with field mappings, retention, and
              downsampling settings.
            </p>
          </div>
          <div className="p-3 rounded border border-border bg-bg-surface-2">
            <code className="text-accent text-xs font-mono">Data Explorer</code>
            <p className="mt-1 text-sm">
              Query historical data with time range, aggregation, and filtering
              parameters.
            </p>
          </div>
        </div>
      </WikiSection>

      <WikiSection title="Resilience">
        <p>
          The Historian is designed for industrial reliability:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Disk Buffer</strong> &mdash; When TimescaleDB is unreachable, messages
            are buffered to local disk and replayed automatically on reconnect
          </li>
          <li>
            <strong>Backpressure</strong> &mdash; If the write queue exceeds a configurable
            threshold, the MQTT client pauses consumption to prevent OOM
          </li>
          <li>
            <strong>3-Retry Dead-Letter</strong> &mdash; Failed messages are retried 3 times
            with exponential backoff before being moved to a dead-letter topic
          </li>
          <li>
            <strong>COPY Protocol</strong> &mdash; Bulk inserts via PostgreSQL COPY are
            atomic and significantly faster than individual INSERTs
          </li>
        </ul>
        <WikiCallout type="tip">
          The Historian works hand-in-hand with the{" "}
          <Link href="/docs/wiki/knowledge-graph" className="text-accent hover:underline">
            Knowledge Graph
          </Link>{" "}
          &mdash; machines and sensors discovered in the KG automatically get
          historian subscriptions.
        </WikiCallout>
      </WikiSection>
    </>
  );
}
