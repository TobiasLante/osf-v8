import Link from 'next/link';
import { BackgroundOrbs } from '@/components/BackgroundOrbs';

export default function GitHubHelpPage() {
  return (
    <>
      <BackgroundOrbs />
      <section className="pt-28 pb-20 px-6">
        <div className="mx-auto max-w-3xl">
          <Link href="/docs" className="text-text-muted hover:text-accent text-sm mb-6 inline-block">&larr; Back to Docs</Link>

          <div className="mb-8 p-4 rounded-md border border-accent/30 bg-accent/5">
            <p className="text-sm text-text-muted">
              This guide has moved to the Wiki.{' '}
              <Link href="/docs/wiki/code-agents" className="text-accent hover:underline font-medium">
                Go to Code Agents Guide &rarr;
              </Link>
            </p>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold mb-4">GitHub Code Agents</h1>
          <p className="text-text-muted mb-10 text-lg">
            Write TypeScript agents in your own GitHub repository and deploy them to OpenShopFloor with one click.
          </p>

          {/* Overview */}
          <div className="space-y-8">
            <Section title="What are Code Agents?">
              <p>
                Code Agents let you write custom TypeScript functions that have full access to all 111 MCP tools,
                an LLM for analysis, and persistent key-value storage. Your code runs in a secure V8 sandbox
                with no file system or network access &mdash; all external calls go through the SDK.
              </p>
            </Section>

            <Section title="Quick Start">
              <ol className="list-decimal list-inside space-y-3">
                <li>
                  <strong>Connect GitHub</strong> &mdash; Go to{' '}
                  <Link href="/settings" className="text-accent hover:underline">Settings &rarr; GitHub</Link>{' '}
                  and connect your account.
                </li>
                <li>
                  <strong>Create a repository</strong> with two files:
                  <Code filename="osf-agent.yaml">{`name: My First Agent
description: Analyzes OEE data
icon: "\uD83D\uDCCA"
entry: src/main.ts
timeout: 60`}</Code>
                  <Code filename="src/main.ts">{`export default async function main(ctx) {
  // Call any MCP tool
  const oee = await ctx.mcp.call('factory_get_latest_oee');
  ctx.log('OEE data received');

  // Use LLM for analysis
  const analysis = await ctx.llm.chat(
    \`Analyze this OEE data and suggest improvements: \${JSON.stringify(oee)}\`
  );
  ctx.log(analysis);

  // Store results for later
  await ctx.storage.set('last_analysis', {
    timestamp: new Date().toISOString(),
    analysis,
  });

  return { analysis };
}`}</Code>
                </li>
                <li>
                  <strong>Deploy</strong> &mdash; Go to{' '}
                  <Link href="/agents/code/new" className="text-accent hover:underline">Agents &rarr; Deploy from GitHub</Link>,
                  select your repo, and click Deploy.
                </li>
                <li>
                  <strong>Run</strong> &mdash; Open your agent&apos;s detail page and click Run. Watch the output stream in real time.
                </li>
              </ol>
            </Section>

            <Section title="The SDK Context (ctx)">
              <p className="mb-4">Your <code className="text-accent bg-accent/10 px-1 rounded text-xs">main(ctx)</code> function receives a context object with these modules:</p>

              <h4 className="font-semibold text-sm mt-4 mb-2">ctx.mcp</h4>
              <table className="w-full text-sm border border-border rounded-md overflow-hidden">
                <thead><tr className="bg-bg-surface-2 text-text-dim"><th className="text-left p-3">Method</th><th className="text-left p-3">Description</th></tr></thead>
                <tbody>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">ctx.mcp.call(name, args?)</td><td className="p-3 text-text-muted">Call any MCP tool. Returns parsed JSON result.</td></tr>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">ctx.mcp.listTools()</td><td className="p-3 text-text-muted">List all available MCP tools with descriptions.</td></tr>
                </tbody>
              </table>

              <h4 className="font-semibold text-sm mt-4 mb-2">ctx.llm</h4>
              <table className="w-full text-sm border border-border rounded-md overflow-hidden">
                <thead><tr className="bg-bg-surface-2 text-text-dim"><th className="text-left p-3">Method</th><th className="text-left p-3">Description</th></tr></thead>
                <tbody>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">ctx.llm.chat(prompt)</td><td className="p-3 text-text-muted">Send a prompt to the LLM. Returns the text response.</td></tr>
                </tbody>
              </table>

              <h4 className="font-semibold text-sm mt-4 mb-2">ctx.storage</h4>
              <table className="w-full text-sm border border-border rounded-md overflow-hidden">
                <thead><tr className="bg-bg-surface-2 text-text-dim"><th className="text-left p-3">Method</th><th className="text-left p-3">Description</th></tr></thead>
                <tbody>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">ctx.storage.get(key)</td><td className="p-3 text-text-muted">Read a stored value (scoped per agent + user).</td></tr>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">ctx.storage.set(key, value)</td><td className="p-3 text-text-muted">Store any JSON-serializable value.</td></tr>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">ctx.storage.delete(key)</td><td className="p-3 text-text-muted">Remove a stored value.</td></tr>
                </tbody>
              </table>

              <h4 className="font-semibold text-sm mt-4 mb-2">ctx.log</h4>
              <table className="w-full text-sm border border-border rounded-md overflow-hidden">
                <thead><tr className="bg-bg-surface-2 text-text-dim"><th className="text-left p-3">Method</th><th className="text-left p-3">Description</th></tr></thead>
                <tbody>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">ctx.log(message)</td><td className="p-3 text-text-muted">Log a message to the live output terminal.</td></tr>
                </tbody>
              </table>
            </Section>

            <Section title="Using osf-ts in Flows (Multi-Output)">
              <p>
                Code agents can also be used as <code className="text-accent bg-accent/10 px-1 rounded text-xs">osf-ts</code> nodes inside
                Node-RED flows. The osf-ts node supports <strong>multi-output</strong> &mdash; configure 1 to 5 output ports and return an array
                to route different results to different downstream paths.
              </p>
              <Code filename="osf-ts node (2 outputs)">{`// Return an array — each element goes to a different output port
const oee = await ctx.mcp.call('factory_get_latest_oee');
const isGood = oee.oee_percent > 85;

return [
  isGood ? oee : null,     // Port 0: good OEE → continue
  !isGood ? oee : null,    // Port 1: bad OEE → alert path
];`}</Code>
              <p>
                When the node has 1 output (default), return a single value as usual. When configured with multiple outputs,
                return an array where each element maps to an output port. Use <code className="text-accent bg-accent/10 px-1 rounded text-xs">null</code> to
                skip a port.
              </p>
            </Section>

            <Section title="Manifest Reference (osf-agent.yaml)">
              <table className="w-full text-sm border border-border rounded-md overflow-hidden">
                <thead><tr className="bg-bg-surface-2 text-text-dim"><th className="text-left p-3">Field</th><th className="text-left p-3">Required</th><th className="text-left p-3">Default</th><th className="text-left p-3">Description</th></tr></thead>
                <tbody>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">name</td><td className="p-3">Yes</td><td className="p-3">&mdash;</td><td className="p-3 text-text-muted">Display name of the agent</td></tr>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">description</td><td className="p-3">No</td><td className="p-3">&mdash;</td><td className="p-3 text-text-muted">Short description shown in the UI</td></tr>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">icon</td><td className="p-3">No</td><td className="p-3">💻</td><td className="p-3 text-text-muted">Emoji icon</td></tr>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">entry</td><td className="p-3">No</td><td className="p-3">src/main.ts</td><td className="p-3 text-text-muted">Path to the entry file</td></tr>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">timeout</td><td className="p-3">No</td><td className="p-3">60</td><td className="p-3 text-text-muted">Max execution time in seconds (max 300)</td></tr>
                </tbody>
              </table>
            </Section>

            <Section title="Auto-Sync via Webhooks">
              <p>
                When you push to your repository, OpenShopFloor automatically re-syncs your agent.
                The platform fetches the latest <code className="text-accent bg-accent/10 px-1 rounded text-xs">osf-agent.yaml</code> and entry file,
                re-bundles the code, and updates the deployment. You can also manually trigger a sync
                from the agent detail page.
              </p>
            </Section>

            <Section title="Security & Limits">
              <ul className="list-disc list-inside space-y-2">
                <li>Code runs in an isolated V8 sandbox (isolated-vm) &mdash; no filesystem, no network, no require/import</li>
                <li>Memory limit: 128 MB per execution</li>
                <li>Timeout: configurable up to 300 seconds</li>
                <li>Rate limit: 3 runs per minute</li>
                <li>All MCP and storage calls are scoped to your user ID</li>
                <li>GitHub tokens are encrypted with AES-256-GCM</li>
                <li>Repository must be public (open source)</li>
              </ul>
            </Section>

            <Section title="Examples">
              <h4 className="font-semibold text-sm mb-2">Machine Status Monitor</h4>
              <Code filename="src/main.ts">{`export default async function main(ctx) {
  const machines = await ctx.mcp.call('factory_get_all_machines');
  const stopped = machines.filter(m => m.status === 'stopped');

  if (stopped.length > 0) {
    const report = await ctx.llm.chat(
      \`These machines are stopped. Analyze possible causes: \${JSON.stringify(stopped)}\`
    );
    ctx.log(\`⚠ \${stopped.length} machines stopped\`);
    ctx.log(report);
  } else {
    ctx.log('All machines running normally');
  }
}`}</Code>

              <h4 className="font-semibold text-sm mt-6 mb-2">Daily Quality Report</h4>
              <Code filename="src/main.ts">{`export default async function main(ctx) {
  const defects = await ctx.mcp.call('quality_get_defect_summary');
  const previous = await ctx.storage.get('last_defects');

  const report = await ctx.llm.chat(\`
    Create a quality report comparing current defects with previous data.
    Current: \${JSON.stringify(defects)}
    Previous: \${JSON.stringify(previous)}
  \`);

  await ctx.storage.set('last_defects', defects);
  ctx.log(report);
  return { report, defectCount: defects.length };
}`}</Code>

              <h4 className="font-semibold text-sm mt-6 mb-2">Multi-Output Router (osf-ts in Flows)</h4>
              <Code filename="osf-ts node (3 outputs)">{`// Classify machines and route to 3 different paths
const machines = await ctx.mcp.call('factory_get_all_machines');

const running = machines.filter(m => m.status === 'running');
const idle = machines.filter(m => m.status === 'idle');
const stopped = machines.filter(m => m.status === 'stopped');

return [running, idle, stopped];
// Port 0 → running machines pipeline
// Port 1 → idle analysis
// Port 2 → stopped alert flow`}</Code>
            </Section>
          </div>
        </div>
      </section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md p-6 bg-bg-surface">
      <h2 className="text-xl font-bold mb-4">{title}</h2>
      <div className="text-sm text-text-muted leading-relaxed space-y-3">{children}</div>
    </div>
  );
}

function Code({ filename, children }: { filename: string; children: string }) {
  return (
    <div className="mt-3 mb-3 rounded-md border border-border overflow-hidden">
      <div className="bg-bg-surface-2 px-3 py-1.5 text-xs text-text-dim font-mono border-b border-border">{filename}</div>
      <pre className="bg-[#0d1117] p-4 text-xs font-mono text-gray-300 overflow-x-auto leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}
