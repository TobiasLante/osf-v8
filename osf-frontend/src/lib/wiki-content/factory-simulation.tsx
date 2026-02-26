import { WikiSection } from "@/components/wiki/WikiSection";
import { WikiCallout } from "@/components/wiki/WikiCallout";

export function FactorySimulationContent() {
  return (
    <>
      <WikiSection title="Overview">
        <p>
          The OpenShopFloor factory simulation models a complete manufacturing
          facility with CNC machining, injection molding, assembly, and quality
          control. The simulation runs continuously, generating realistic
          production events, machine state changes, quality data, and order
          progress.
        </p>
        <p>
          All data is stored in SQLite databases and exposed through MCP tools.
          You can view the live factory state on the{" "}
          <a
            href="https://osf-factory.zeroguess.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Factory Dashboard
          </a>
          .
        </p>
      </WikiSection>

      <WikiSection title="Production Areas">
        <div className="space-y-4 mt-2">
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">CNC Machining</h4>
            <p>
              5 CNC turning and milling centers (CNC-01 to CNC-05). Each machine
              processes metal parts with individual cycle times, tool wear
              tracking, and maintenance schedules. Machine states include running,
              idle, setup, maintenance, and stopped.
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">
              Injection Molding (SGM)
            </h4>
            <p>
              3 injection molding machines (SGM-01 to SGM-03) producing plastic
              components. Each machine tracks cycle times, shot counts, mold
              temperature, and material usage. Quality data includes short shots,
              flash, sink marks, and dimensional checks.
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">Pre-Assembly</h4>
            <p>
              Sub-assembly operations that combine CNC and SGM parts into
              intermediate assemblies. Tracks station utilization, assembly
              sequence, and component availability.
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">Final Assembly</h4>
            <p>
              Multi-station assembly line for finished products. Each station has
              individual cycle times and quality checks. Station-level tracking
              shows throughput and bottlenecks.
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">Test Field</h4>
            <p>
              End-of-line testing with functional checks and quality
              verification. Pass/fail data feeds into the QMS for defect tracking
              and root cause analysis.
            </p>
          </div>
        </div>
      </WikiSection>

      <WikiSection title="Key Metrics">
        <div className="space-y-4 mt-2">
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-1">
              OEE (Overall Equipment Effectiveness)
            </h4>
            <p>
              Calculated per machine as Availability x Performance x Quality.
              World-class target is 85%. Available per machine and as factory
              average via{" "}
              <code className="text-accent bg-accent/10 px-1 rounded text-xs">
                factory_get_latest_oee
              </code>
              .
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-1">On-Time Delivery (OTD)</h4>
            <p>
              Percentage of customer orders delivered on or before the promised
              date. Tracked per customer and overall via{" "}
              <code className="text-accent bg-accent/10 px-1 rounded text-xs">
                factory_get_customer_otd
              </code>
              .
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-1">Defect Rate</h4>
            <p>
              Parts per million (PPM) defective, tracked per machine and product.
              Defect types include dimensional, visual, and functional defects.
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-1">Capacity Utilization</h4>
            <p>
              How much of the available capacity is being used. Shown per machine,
              per area, and factory-wide.
            </p>
          </div>
        </div>
      </WikiSection>

      <WikiSection title="Data Model">
        <p>The simulation uses several interconnected data domains:</p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Machines</strong> &mdash; ID, type, area, status, current
            order, cycle time, OEE components
          </li>
          <li>
            <strong>Production Orders</strong> &mdash; Order ID, product, quantity,
            due date, priority, status, routing steps
          </li>
          <li>
            <strong>Materials</strong> &mdash; Stock levels, reservations,
            reorder points, lead times
          </li>
          <li>
            <strong>Quality Records</strong> &mdash; Inspection results, defect
            types, SPC data, CAPA actions
          </li>
          <li>
            <strong>Tools</strong> &mdash; Tool inventory, wear levels, expected
            life, replacement schedule
          </li>
          <li>
            <strong>Customers</strong> &mdash; Customer data, delivery history,
            OTD performance
          </li>
        </ul>
        <WikiCallout type="info">
          The simulation resets periodically to maintain realistic data
          distributions. Historical data is retained for trend analysis.
        </WikiCallout>
      </WikiSection>

      <WikiSection title="MCP Integration">
        <p>
          Each data domain is served by a dedicated MCP server. The gateway
          proxies tool calls to the right server based on the tool name prefix:
        </p>
        <table className="w-full text-sm border border-border rounded-md overflow-hidden mt-3">
          <thead>
            <tr className="bg-bg-surface-2 text-text-dim">
              <th className="text-left p-3">Prefix</th>
              <th className="text-left p-3">Server</th>
              <th className="text-left p-3">Domain</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">factory_</td>
              <td className="p-3 text-text-muted">mcp-fertigung:8024</td>
              <td className="p-3 text-text-muted">
                Machines, OEE, production, tools
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">erp_</td>
              <td className="p-3 text-text-muted">mcp-erp:8021</td>
              <td className="p-3 text-text-muted">
                Orders, customers, materials, BOM
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">quality_</td>
              <td className="p-3 text-text-muted">mcp-qms:8023</td>
              <td className="p-3 text-text-muted">
                Defects, inspections, SPC, audits
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">warehouse_</td>
              <td className="p-3 text-text-muted">mcp-wms:8022</td>
              <td className="p-3 text-text-muted">
                Inventory, stock, locations
              </td>
            </tr>
          </tbody>
        </table>
      </WikiSection>
    </>
  );
}
