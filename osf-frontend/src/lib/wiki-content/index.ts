import { GettingStartedContent } from "./getting-started";
import { ArchitectureContent } from "./architecture";
import { VisualFlowsContent } from "./visual-flows";
import { CodeAgentsContent } from "./code-agents";
import { NodeReferenceContent } from "./node-reference";
import { ApiReferenceContent } from "./api-reference";
import { McpToolsContent } from "./mcp-tools";
import { FactorySimulationContent } from "./factory-simulation";
import { TroubleshootingContent } from "./troubleshooting";
import { SelfHostingContent } from "./self-hosting";

export const wikiContent: Record<string, React.ComponentType> = {
  "getting-started": GettingStartedContent,
  architecture: ArchitectureContent,
  "visual-flows": VisualFlowsContent,
  "code-agents": CodeAgentsContent,
  "node-reference": NodeReferenceContent,
  "api-reference": ApiReferenceContent,
  "mcp-tools": McpToolsContent,
  "factory-simulation": FactorySimulationContent,
  troubleshooting: TroubleshootingContent,
  "self-hosting": SelfHostingContent,
};
