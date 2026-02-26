export interface Challenge {
  id: string;
  name: string;
  description: string;
  longDescription: string;
  kpiGoal: string;
  timeLimit: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced" | "Expert";
  icon: string;
  rules: string[];
  tools: string[];
}

export const challenges: Challenge[] = [
  {
    id: "oee-champion",
    name: "OEE Champion",
    description:
      "Achieve and maintain OEE above 85% across all machines for a full 24-hour simulated period.",
    longDescription:
      "The OEE Champion challenge tests your ability to monitor and optimize Overall Equipment Effectiveness across an entire factory floor. You'll need to identify underperforming machines, diagnose root causes (availability losses, speed losses, quality losses), and take corrective actions — all while the factory continues producing. Can you keep every machine above the 85% world-class threshold?",
    kpiGoal: "OEE > 85% over 24h",
    timeLimit: "1 hour",
    difficulty: "Beginner",
    icon: "🏆",
    rules: [
      "All CNC and SGM machines must maintain OEE > 85%",
      "Measured over 24 simulated hours",
      "You may use any OEE, capacity, and maintenance tools",
      "No manual machine restarts allowed",
    ],
    tools: [
      "factory_get_latest_oee",
      "factory_get_machine_oee",
      "factory_get_production_history",
      "factory_get_capacity_overview",
    ],
  },
  {
    id: "zero-delay",
    name: "Zero Delay",
    description:
      "Ensure zero late deliveries over a 48-hour simulated window by managing priorities and capacity.",
    longDescription:
      "In the Zero Delay challenge, customer satisfaction is everything. Over 48 simulated hours, you must ensure every single customer order ships on time. This requires proactive monitoring of at-risk orders, smart capacity reallocation, material readiness verification, and sometimes tough prioritization decisions. One late delivery means failure.",
    kpiGoal: "0 late deliveries in 48h",
    timeLimit: "2 hours",
    difficulty: "Intermediate",
    icon: "🎯",
    rules: [
      "No customer orders may be delivered late",
      "Measured over 48 simulated hours",
      "You may reprioritize orders and adjust capacity",
      "Material shortages must be resolved proactively",
    ],
    tools: [
      "factory_get_orders_at_risk",
      "factory_get_customer_otd",
      "factory_check_material_readiness",
      "factory_get_va05_summary",
    ],
  },
  {
    id: "lean-inventory",
    name: "Lean Inventory",
    description:
      "Reduce inventory holding costs by 20% without causing any material stockouts.",
    longDescription:
      "The Lean Inventory challenge puts your supply chain skills to the test. Excess inventory ties up capital and space, but running too lean causes production stops. Your mission: cut inventory costs by 20% while ensuring zero stockouts. You'll need to analyze demand patterns, optimize reorder points, and time purchases perfectly.",
    kpiGoal: "Inventory cost -20%, 0 stockouts",
    timeLimit: "2 hours",
    difficulty: "Intermediate",
    icon: "📦",
    rules: [
      "Reduce total inventory value by at least 20%",
      "Zero stockouts allowed during the period",
      "All work orders must continue without material delays",
      "You may adjust reorder points and purchase orders",
    ],
    tools: [
      "factory_get_low_stock_items",
      "factory_get_stock_item",
      "factory_get_pending_purchases",
      "factory_get_md04_overview",
    ],
  },
  {
    id: "quality-first",
    name: "Quality First",
    description:
      "Achieve Cpk > 1.33 on all quality characteristics and resolve all SPC alarms.",
    longDescription:
      "Quality First is the ultimate quality management challenge. You must achieve statistical process control across all measured characteristics, with every Cpk value above the 1.33 threshold. Active SPC alarms must be investigated and resolved, calibrations must be current, and quality notifications must be addressed. This challenge requires deep understanding of SPC principles.",
    kpiGoal: "Cpk > 1.33 all characteristics, 0 SPC alarms",
    timeLimit: "1 hour",
    difficulty: "Advanced",
    icon: "🔬",
    rules: [
      "All measured characteristics must have Cpk > 1.33",
      "No active SPC alarms at challenge end",
      "All calibrations must be current",
      "Quality notifications must be addressed",
    ],
    tools: [
      "factory_get_spc_alarms",
      "factory_get_cpk_overview",
      "factory_get_calibration_due",
      "factory_get_quality_notifications",
    ],
  },
  {
    id: "energy-saver",
    name: "Energy Saver",
    description:
      "Reduce energy consumption per part by 15% over a 24-hour simulated period.",
    longDescription:
      "The Energy Saver challenge tests your ability to optimize energy consumption without sacrificing productivity. Reduce the kWh-per-part metric by 15% while keeping production output stable. You'll need to identify energy-hungry machines, optimize scheduling to reduce idle time, and find creative ways to lower the factory's energy footprint.",
    kpiGoal: "kWh/part -15% over 24h",
    timeLimit: "1 hour",
    difficulty: "Beginner",
    icon: "🌱",
    rules: [
      "Average kWh per part must decrease by 15%",
      "Production output must remain stable (±5%)",
      "Measured over 24 simulated hours",
      "Machine idle time counts against you",
    ],
    tools: [
      "factory_get_energy_overview",
      "factory_get_energy_per_part",
      "factory_get_base_load",
      "factory_get_energy_per_machine",
    ],
  },
  {
    id: "full-auto",
    name: "Full Auto",
    description:
      "Keep the factory running autonomously for 72 simulated hours with no manual intervention.",
    longDescription:
      "Full Auto is the ultimate test of AI-driven manufacturing. Design a complete autonomous strategy that keeps the factory running for 72 simulated hours without any manual intervention. All KPIs must stay green: OEE above 75%, no stockouts, no late deliveries, quality within spec. This is where you prove that AI agents can truly run a factory.",
    kpiGoal: "72h autonomous, all KPIs green",
    timeLimit: "4 hours",
    difficulty: "Expert",
    icon: "🤖",
    rules: [
      "Factory must run 72 simulated hours without manual intervention",
      "OEE must stay above 75%",
      "No stockouts or late deliveries",
      "All agent decisions are logged for review",
    ],
    tools: [
      "factory_get_latest_oee",
      "factory_get_capacity_overview",
      "factory_get_orders_at_risk",
      "factory_get_low_stock_items",
      "factory_get_spc_alarms",
      "factory_get_energy_overview",
      "factory_get_kpi_dashboard",
    ],
  },
];

export function getChallenge(id: string): Challenge | undefined {
  return challenges.find((c) => c.id === id);
}
