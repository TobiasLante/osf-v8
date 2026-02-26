export interface Agent {
  id: string;
  name: string;
  type: "operational" | "langgraph" | "strategic";
  category: string;
  description: string;
  longDescription: string;
  tools: string[];
  difficulty: "Beginner" | "Intermediate" | "Advanced" | "Expert";
  icon: string;
  featured: boolean;
}

export const agents: Agent[] = [
  {
    id: "oee-monitor",
    name: "OEE Monitor",
    type: "operational",
    category: "Production",
    description:
      "Monitors OEE across all machines, detects drops, and suggests corrective actions.",
    longDescription:
      "The OEE Monitor agent continuously watches Overall Equipment Effectiveness metrics across all CNC and injection molding machines. It identifies machines dropping below the 85% target, analyzes root causes by breaking down availability, performance, and quality factors, and recommends specific corrective actions. Ideal for production managers who need a quick factory health check.",
    tools: [
      "factory_get_latest_oee",
      "factory_get_machine_oee",
      "factory_get_production_history",
      "factory_get_scrap_overview",
    ],
    difficulty: "Beginner",
    icon: "📊",
    featured: true,
  },
  {
    id: "material-agent",
    name: "Material Agent",
    type: "langgraph",
    category: "Supply Chain",
    description:
      "Detects material shortages, checks stock levels, and creates purchase suggestions.",
    longDescription:
      "The Material Agent uses LangGraph multi-agent orchestration to detect material shortages before they cause production stops. It cross-references current stock levels with upcoming work order requirements, reviews pending purchase orders, and generates prioritized purchasing recommendations. This agent prevents the #1 cause of unplanned downtime: missing materials.",
    tools: [
      "factory_get_stock_item",
      "factory_get_low_stock_items",
      "factory_get_pending_purchases",
      "factory_get_md04_overview",
      "factory_get_mrp_shortages",
    ],
    difficulty: "Intermediate",
    icon: "📦",
    featured: true,
  },
  {
    id: "capacity-agent",
    name: "Capacity Agent",
    type: "langgraph",
    category: "Production",
    description:
      "Resolves blocked orders, balances workload across machines, optimizes capacity utilization.",
    longDescription:
      "The Capacity Agent tackles one of manufacturing's hardest problems: optimal machine utilization. It analyzes the current workload distribution, identifies blocked or overloaded machines, and suggests load-balancing actions. It also handles CM21 orders that need rescheduling due to capacity conflicts, ensuring maximum throughput without overloading any single resource.",
    tools: [
      "factory_get_capacity_overview",
      "factory_get_cm01",
      "factory_get_cm21_orders",
      "factory_get_blocked_orders_count",
      "factory_get_machine_queue",
    ],
    difficulty: "Intermediate",
    icon: "⚙️",
    featured: true,
  },
  {
    id: "deadline-agent",
    name: "Deadline Agent",
    type: "langgraph",
    category: "Delivery",
    description:
      "Monitors delivery deadlines, prioritizes at-risk orders, ensures on-time delivery.",
    longDescription:
      "The Deadline Agent is your early warning system for late deliveries. It continuously scans for orders at risk of missing their delivery date, correlates with customer on-time delivery rates, and verifies material readiness for critical orders. When it detects a risk, it recommends priority changes, expediting actions, or capacity reallocation to protect delivery commitments.",
    tools: [
      "factory_get_orders_at_risk",
      "factory_get_customer_otd",
      "factory_check_material_readiness",
      "factory_get_va05_summary",
      "factory_get_customer_orders",
    ],
    difficulty: "Intermediate",
    icon: "⏰",
    featured: true,
  },
  {
    id: "quality-guard",
    name: "Quality Guard",
    type: "operational",
    category: "Quality",
    description:
      "Monitors SPC alarms, Cpk values, calibration status, and quality notifications.",
    longDescription:
      "The Quality Guard agent is the factory's quality watchdog. It monitors Statistical Process Control (SPC) alarms across all quality characteristics, reviews Cpk values to ensure process capability stays above 1.33, checks calibration due dates for measurement equipment, and tracks quality notifications. When it detects a trend or violation, it provides actionable recommendations to prevent defects.",
    tools: [
      "factory_get_spc_alarms",
      "factory_get_cpk_overview",
      "factory_get_calibration_due",
      "factory_get_quality_notifications",
    ],
    difficulty: "Advanced",
    icon: "🔍",
    featured: true,
  },
  {
    id: "energy-optimizer",
    name: "Energy Optimizer",
    type: "operational",
    category: "Sustainability",
    description:
      "Analyzes energy consumption per machine and per part, identifies optimization potential.",
    longDescription:
      "The Energy Optimizer agent analyzes energy consumption patterns across the entire factory. It calculates kWh per part for each machine, identifies high-consumption outliers, and analyzes base load patterns to find waste. This agent is essential for sustainability reporting and ISO 50001 compliance, providing concrete recommendations to reduce the factory's energy footprint.",
    tools: [
      "factory_get_energy_overview",
      "factory_get_energy_per_part",
      "factory_get_base_load",
      "factory_get_energy_per_machine",
      "factory_get_energy_costs",
      "factory_get_energy_trends",
    ],
    difficulty: "Beginner",
    icon: "⚡",
    featured: true,
  },
  {
    id: "strategic-planner",
    name: "Strategic Planner",
    type: "strategic",
    category: "Planning",
    description:
      "Runs the full strategic pipeline: demand analysis, capacity optimization, MRP planning.",
    longDescription:
      "The Strategic Planner is the most comprehensive agent, running a full factory health analysis pipeline. It starts with demand analysis and order backlog review, moves through capacity utilization and bottleneck identification, performs MRP analysis for material requirements, and finishes with a KPI dashboard review. The result is a strategic summary with prioritized recommendations across all factory dimensions.",
    tools: [
      "factory_get_capacity_overview",
      "factory_get_cm01",
      "factory_get_va05_summary",
      "factory_get_orders_at_risk",
      "factory_get_md04_overview",
      "factory_get_mrp_shortages",
      "factory_get_low_stock_items",
      "factory_get_latest_oee",
      "factory_get_kpi_dashboard",
      "factory_get_otd_rate",
      "factory_get_revenue_statistics",
    ],
    difficulty: "Expert",
    icon: "🎯",
    featured: true,
  },
];

export function getAgent(id: string): Agent | undefined {
  return agents.find((a) => a.id === id);
}

export const agentCategories = Array.from(
  new Set(agents.map((a) => a.category))
);
