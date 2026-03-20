import { UseCase } from "@/components/UseCaseCard";

export const useCases: UseCase[] = [
  {
    title: "OEE Champion",
    icon: "\u{1F4CA}",
    description:
      "Monitor OEE across all machines in real-time. Detect availability drops, performance losses, and quality issues. Trigger alerts when OEE falls below thresholds and suggest corrective actions.",
    tools: [
      "factory_get_latest_oee",
      "factory_get_machine_oee",
      "factory_get_production_history",
      "factory_get_scrap_history",
      "factory_get_downtime_report",
    ],
    kpis: ["OEE > 85%", "Scrap < 2%", "Availability > 90%"],
    difficulty: "Beginner",
  },
  {
    title: "Predictive Maintenance",
    icon: "\u{1F527}",
    description:
      "Analyze MTBF/MTTR patterns, tool wear data, and downtime history. Predict upcoming failures and schedule maintenance before unplanned stops occur. Optimize maintenance windows.",
    tools: [
      "factory_get_machine_reliability",
      "factory_get_downtime_report",
      "tms_get_critical",
      "factory_get_open_notifications",
      "factory_get_maintenance_summary",
    ],
    kpis: ["MTBF +20%", "Unplanned Stops -50%", "Maintenance Cost -15%"],
    difficulty: "Intermediate",
  },
  {
    title: "MRP Optimizer",
    icon: "\u{1F4E6}",
    description:
      "Eliminate material shortages by monitoring MD04/MD07 data. Automatically trigger purchase orders for low-stock items. Balance inventory levels to minimize carrying costs while avoiding stockouts.",
    tools: [
      "factory_get_md04",
      "factory_get_md07",
      "factory_get_low_stock_items",
      "factory_get_pending_purchases",
      "factory_get_supplier_for_material",
    ],
    kpis: ["Shortages → 0", "Inventory Turns +30%", "Purchase Lead Time -20%"],
    difficulty: "Intermediate",
  },
  {
    title: "Quality First",
    icon: "\u{2705}",
    description:
      "Monitor SPC alarms and Cpk values across all processes. Detect drift in injection molding parameters before defects occur. Ensure calibration compliance and track quality notifications.",
    tools: [
      "factory_get_spc_alarms",
      "factory_get_cpk_overview",
      "factory_get_calibration_due",
      "sgm_get_process_trend",
      "sgm_get_cavity_balance",
    ],
    kpis: ["Cpk > 1.33", "SPC Alarms → 0", "Calibration 100%"],
    difficulty: "Advanced",
  },
  {
    title: "Energy Saver",
    icon: "\u{26A1}",
    description:
      "Track energy consumption per machine and per part. Identify energy-inefficient operations, optimize base load vs. production load, and reduce kWh/part through intelligent scheduling.",
    tools: [
      "factory_get_energy_overview",
      "factory_get_energy_per_part",
      "factory_get_energy_costs",
      "factory_get_energy_trend",
      "factory_get_base_load",
    ],
    kpis: ["kWh/Part -15%", "Energy Cost -10%", "Base Load Optimized"],
    difficulty: "Beginner",
  },
  {
    title: "On-Time Delivery",
    icon: "\u{1F4C5}",
    description:
      "Ensure customer order delivery dates are met. Monitor at-risk orders, track production progress against deadlines, and coordinate capacity and material availability proactively.",
    tools: [
      "factory_get_orders_at_risk",
      "factory_get_customer_otd",
      "factory_get_otd_statistics",
      "factory_get_capacity_summary",
      "factory_check_material_readiness",
    ],
    kpis: ["OTD > 95%", "Late Orders → 0", "Risk Detection -48h"],
    difficulty: "Advanced",
  },
  {
    title: "Supply Chain Risk Radar",
    icon: "\u{1F6E1}",
    description:
      "Use Knowledge Graph impact analysis to identify single-point-of-failure suppliers, trace order dependencies across machines, and simulate what-if scenarios for machine downtime.",
    tools: [
      "kg_impact",
      "kg_path",
      "kg_neighbors",
      "kg_aggregate",
      "factory_get_supplier_evaluation",
    ],
    kpis: ["Supply chain resilience score", "Single-point-of-failure count", "Alternative supplier coverage"],
    difficulty: "Advanced",
  },
  {
    title: "Real-Time Anomaly Detective",
    icon: "\u{1F50D}",
    description:
      "Monitor live MQTT sensor data via the Unified Namespace, detect anomalies using the Historian's statistical analysis, and correlate findings with KG context for root cause analysis.",
    tools: [
      "history_anomalies",
      "history_get_trend",
      "kg_discovered_machines",
      "kg_machine_sensors",
      "uns_query_latest",
    ],
    kpis: ["Anomaly detection rate", "Mean time to root cause", "False positive ratio"],
    difficulty: "Intermediate",
  },
  {
    title: "Digital Thread Tracer",
    icon: "\u{1F9F5}",
    description:
      "Trace a product's complete digital thread — from raw material through production to delivery — using Knowledge Graph path analysis and factory order data.",
    tools: [
      "kg_path",
      "kg_subgraph",
      "factory_get_work_order",
      "factory_get_bom_multi_level",
      "factory_get_customer_orders",
    ],
    kpis: ["Order traceability depth", "Material genealogy coverage", "Lead time visibility"],
    difficulty: "Beginner",
  },
];
