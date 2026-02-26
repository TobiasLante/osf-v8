import Link from "next/link";
import { WikiSection } from "@/components/wiki/WikiSection";

export function TroubleshootingContent() {
  return (
    <>
      <WikiSection title="Common Issues">
        <div className="space-y-6">
          <div>
            <h4 className="font-semibold text-sm mb-2">
              &quot;Session expired&quot; or constant logouts
            </h4>
            <p>
              JWT tokens expire after 24 hours. If you&apos;re logged out
              frequently, your browser may be blocking cookies or your clock may
              be skewed. Try:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Clear browser storage and log in again</li>
              <li>Check that your system clock is accurate</li>
              <li>Ensure third-party cookies are not blocked for this domain</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-2">
              Chat not responding / SSE stream stuck
            </h4>
            <p>
              The AI chat uses Server-Sent Events (SSE) for streaming. If the
              stream seems stuck:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Wait 30 seconds &mdash; LLM calls can take time</li>
              <li>
                Check if you&apos;re behind a proxy that buffers SSE (corporate
                proxies sometimes do this)
              </li>
              <li>Refresh the page and try again</li>
              <li>
                If using a VPN, try disconnecting &mdash; some VPNs interfere
                with long-lived connections
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-2">
              Flow editor not loading
            </h4>
            <p>
              The Node-RED editor runs in an iframe. If it shows a blank screen:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>
                Check browser console for CSP or X-Frame-Options errors
              </li>
              <li>
                Disable browser extensions that block iframes (e.g., uBlock
                Origin in strict mode)
              </li>
              <li>Try a different browser or incognito mode</li>
              <li>
                Ensure cookies are enabled &mdash; the editor auth uses the{" "}
                <code className="text-accent bg-accent/10 px-1 rounded text-xs">
                  osf_editor_token
                </code>{" "}
                cookie
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-2">
              Agent run fails with &quot;timeout&quot;
            </h4>
            <p>
              Code agents have a configurable timeout (default 60s, max 300s).
              If your agent times out:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>
                Increase the timeout in{" "}
                <code className="text-accent bg-accent/10 px-1 rounded text-xs">
                  osf-agent.yaml
                </code>
              </li>
              <li>
                Reduce MCP calls &mdash; each tool call adds latency
              </li>
              <li>
                Avoid calling the LLM multiple times in sequence when possible
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-2">
              Flow execution shows &quot;zombie&quot; run
            </h4>
            <p>
              A flow run that stays in &quot;running&quot; state indefinitely is
              usually caused by a server restart during execution. These runs are
              automatically marked as failed after a timeout. You can safely
              ignore them and start a new run.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-2">
              GitHub agent sync fails
            </h4>
            <p>Check the following:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>
                The repository must be <strong>public</strong>
              </li>
              <li>
                The repo must contain a valid{" "}
                <code className="text-accent bg-accent/10 px-1 rounded text-xs">
                  osf-agent.yaml
                </code>{" "}
                at the root
              </li>
              <li>The entry file path must match what&apos;s in the manifest</li>
              <li>
                Your GitHub connection may have expired &mdash; try reconnecting
                in Settings
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-2">
              MCP tool returns empty or error result
            </h4>
            <p>
              MCP tool calls can fail if the tool name is wrong or required
              parameters are missing:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>
                Check the{" "}
                <Link
                  href="/docs#tools"
                  className="text-accent hover:underline"
                >
                  Tool Reference
                </Link>{" "}
                for the exact tool name and required parameters
              </li>
              <li>
                Tool names are case-sensitive and use underscores (e.g.,{" "}
                <code className="text-accent bg-accent/10 px-1 rounded text-xs">
                  factory_get_latest_oee
                </code>
                )
              </li>
              <li>
                Some tools return empty results if no data matches the query
                &mdash; this is expected
              </li>
            </ul>
          </div>
        </div>
      </WikiSection>

      <WikiSection title="FAQ">
        <div className="space-y-6">
          <div>
            <h4 className="font-semibold text-sm mb-1">
              Is the factory data real?
            </h4>
            <p>
              No. OSF uses a continuously running simulation that generates
              realistic manufacturing data. The data patterns are modeled after
              real factory scenarios, but all data is synthetic.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-1">
              Can I use my own LLM?
            </h4>
            <p>
              In the hosted version, the platform uses locally hosted LLMs. If
              you self-host, you can configure any OpenAI-compatible LLM endpoint
              via environment variables.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-1">
              What LLM models does OSF use?
            </h4>
            <p>
              The hosted instance uses qwen2.5-14b for specialist tasks and a
              larger model for moderation and synthesis. Both run on local GPUs.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-1">
              Can multiple users use it at the same time?
            </h4>
            <p>
              Yes. Each user has their own conversations, agents, and flows. MCP
              tool calls are shared across the same factory simulation. LLM
              requests are queued when the GPU is busy.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-1">
              Is there rate limiting?
            </h4>
            <p>
              Yes. Agent runs are limited to 3 per minute. Chat messages and MCP
              calls have higher limits. These limits protect the shared LLM
              server from overload.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-1">Is OSF open source?</h4>
            <p>
              Yes. Both the frontend and gateway are open source. You can
              self-host the entire platform. See the{" "}
              <Link
                href="/docs/wiki/self-hosting"
                className="text-accent hover:underline"
              >
                Self-Hosting Guide
              </Link>
              .
            </p>
          </div>
        </div>
      </WikiSection>

      <WikiSection title="Getting Help">
        <p>If you&apos;re stuck, here are your options:</p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <a
              href="https://github.com/TobiasLante/openshopfloor/discussions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              GitHub Discussions
            </a>{" "}
            &mdash; Ask questions and share ideas
          </li>
          <li>
            <a
              href="https://discord.gg/openshopfloor"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Discord
            </a>{" "}
            &mdash; Chat with the community
          </li>
          <li>
            <a
              href="https://github.com/TobiasLante/openshopfloor/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              GitHub Issues
            </a>{" "}
            &mdash; Report bugs
          </li>
        </ul>
      </WikiSection>
    </>
  );
}
