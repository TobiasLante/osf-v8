# Factory Skills — Tool Reference

This document describes ALL available tools organized by domain. Use it to select the right tools for any question.

## Production & OEE
**When:** OEE, machine performance, availability, downtime, scrap, production output, shift reports
**Tools:**
- `factory_get_latest_oee` — Current OEE for ALL machines (last data point per machine — use factory_get_oee_summary for averages)
- `factory_get_oee_summary` — 24h average OEE per machine: avg/min/max OEE, A/P/Q averages, scrap rate. Sorted worst-first. Use this for reports and planning
- `factory_get_machine_oee` — OEE breakdown (A/P/Q) for one machine
- `factory_get_production_history` — Hourly output: good parts, scrap, rework
- `factory_get_scrap_history` — Scrap history grouped by machine
- `factory_get_downtime_report` — Machine downtime with reasons and duration
- `factory_get_machine_reliability` — MTBF, MTTR, availability per machine
- `factory_get_machine_pool_members` — Which machines share a pool (can take each other's orders)
**Patterns:**
- OEE overview → `factory_get_latest_oee`, then drill down per machine with `factory_get_machine_oee`
- Root cause analysis → combine `factory_get_machine_oee` (which component?) + `factory_get_scrap_history` (quality?) + `factory_get_downtime_report` (availability?)
- Machine comparison → `factory_get_machine_oee` for each, then `factory_get_machine_pool_members` to check alternatives

## Capacity & Scheduling
**When:** Machine load, blocked orders, scheduling, rescheduling, bottlenecks, work center capacity, shift patterns
**Tools:**
- `factory_get_capacity_overview` — Load % for ALL machines/work centers
- `factory_get_capacity_summary` — Compact capacity summary: current + next week
- `factory_get_capacity_load` — Average capacity utilization percentage
- `factory_get_cm01` — Capacity per machine by period (like SAP CM01)
- `factory_get_cm21_orders` — Orders per work center (like SAP CM21)
- `factory_get_blocked_orders_count` — Count of blocked orders (material/capacity)
- `factory_get_shift_schedule` — Shift model for all departments: which shifts run when, net minutes, holidays. Optional: machineId for one machine's department
- `factory_get_machine_queue` — Order queue for a specific machine, sorted by priority
- `factory_get_work_order` — Details of a single production order
- `factory_get_arbeitsplan_full` — Full routing: work center, pool, cycle time, setup time, tools
**Patterns:**
- Bottleneck hunt → `factory_get_capacity_overview` (find >95%), then `factory_get_machine_queue` for overloaded machines
- Rescheduling → `factory_get_cm21_orders` + `factory_get_machine_pool_members` to find alternatives
- Blocked order analysis → `factory_get_blocked_orders_count` + `factory_get_work_order` per order
- Shift planning → `factory_get_shift_schedule` for current model, then `factory_get_capacity_summary` to see if extra shifts are needed

## Materials & Stock
**When:** Stock levels, shortages, safety stock, material coverage, purchase orders, MRP
**Tools:**
- `factory_get_low_stock_items` — Materials below safety stock or reorder point
- `factory_get_stock_item` — Exact stock, reservations, availability for one material
- `factory_get_material_coverage` — Coverage in days for all materials (lowest first)
- `factory_get_md04` — Stock/requirements list for one part (like SAP MD04)
- `factory_get_md07` — All current shortages (like SAP MD07)
- `factory_get_pending_purchases` — Open purchase orders with expected delivery
- `factory_get_bom_multi_level` — Multi-level BOM for all articles
- `factory_get_baugruppen_shortages` — Shortages of in-house assemblies (must be produced, not bought)
- `factory_get_availability_at_date` — Forecast part availability at a specific date
**Patterns:**
- Shortage analysis → `factory_get_low_stock_items`, then `factory_get_md04` per material for demand, then `factory_get_pending_purchases` for supply pipeline
- Production readiness → `factory_check_material_readiness` for an order + `factory_get_baugruppen_shortages`
- Coverage risk → `factory_get_material_coverage` (sorted by days), flag < 3 days as critical

## Suppliers & Procurement
**When:** Supplier performance, delivery reliability, purchase suggestions, supplier alternatives
**Tools:**
- `factory_get_supplier_evaluation` — Supplier scorecard: delivery, quality, price
- `factory_get_supplier_for_material` — Find supplier for a material with lead time and price
- `factory_get_supplier_materials` — All supplier-material mappings with lead times
- `factory_check_material_readiness` — Check if all materials are available for a production order
**Patterns:**
- Supplier risk → `factory_get_supplier_evaluation` (find unreliable), then `factory_get_supplier_materials` to check alternatives
- Emergency procurement → `factory_get_supplier_for_material` for the needed material, compare lead times

## Delivery & OTD
**When:** Delivery deadlines, on-time delivery, at-risk orders, customer satisfaction
**Tools:**
- `factory_get_orders_at_risk` — Orders near or past due date
- `factory_get_customer_otd` — OTD rates per customer
- `factory_get_otd_statistics` — Detailed OTD stats: total and per customer
- `factory_get_customer_orders` — All orders for one customer
- `factory_get_customer_order` — Single order detail with delivery status
- `factory_get_va05_summary` — Sales order overview: open, in production, shipped, overdue (like SAP VA05)
- `factory_get_monthly_revenue` — Monthly revenue from delivered orders
**Patterns:**
- Delivery risk → `factory_get_orders_at_risk`, then `factory_get_customer_otd` to weight by customer importance
- Customer deep dive → `factory_get_customer_orders` + `factory_get_customer_otd` for their portfolio
- Order tracking → `factory_get_customer_order` or `factory_get_work_order` for production status

## Quality & SPC
**When:** SPC alarms, process capability, Cpk, calibration, quality complaints, defects
**Tools:**
- `factory_get_spc_alarms` — Active SPC alarms with affected machines/characteristics
- `factory_get_cpk_overview` — Cpk values for all monitored characteristics
- `factory_get_calibration_due` — Gauges due for calibration
- `factory_get_quality_notifications` — Open quality notifications (complaints, internal findings)
**Patterns:**
- Quality alert → `factory_get_spc_alarms` first, then `factory_get_cpk_overview` for capability, then `factory_get_calibration_due` (is the gauge trustworthy?)
- Cpk < 1.0 = NOT capable → immediate action. Cpk 1.0-1.33 = at risk. Cpk > 1.33 = OK

## Energy
**When:** Energy consumption, costs, efficiency, base load, per-part energy
**Tools:**
- `factory_get_energy_overview` — Total consumption and cost, per-machine breakdown
- `factory_get_machine_energy` — Consumption over time for one machine
- `factory_get_energy_per_part` — kWh per good part for a machine
- `factory_get_base_load` — Base load vs. production load per machine
- `factory_get_energy_costs` — Energy costs in EUR
- `factory_get_energy_trend` — Hourly power trend for a machine
**Patterns:**
- Waste identification → `factory_get_base_load` (idle consumption), `factory_get_energy_per_part` (compare machines producing same article)
- Cost optimization → `factory_get_energy_costs` + `factory_get_energy_trend` for peak/off-peak analysis

## Maintenance
**When:** Machine maintenance, repair, open notifications, MTBF, preventive maintenance
**Tools:**
- `factory_get_open_notifications` — Open fault and maintenance notifications
- `factory_get_maintenance_orders` — Maintenance work orders (filter by status)
- `factory_get_maintenance_summary` — PM overview: open notifications, orders, avg MTBF/MTTR
- `factory_get_machine_reliability` — MTBF, MTTR, availability per machine
**Patterns:**
- Maintenance priority → `factory_get_maintenance_summary` for overview, then `factory_get_open_notifications` for details
- Reliability trend → `factory_get_machine_reliability` per machine + `factory_get_downtime_report`

## Subcontracting (Fremdbearbeitung)
**When:** External processing, subcontractor orders, outsourced production
**Tools:**
- `factory_get_fb_auftraege` — All subcontracting orders with status
- `factory_get_fb_bewertung` — Quality rating of subcontractors
- `factory_get_fb_kapazitaet` — Capacity and utilization of subcontractors
- `factory_get_fb_liefertreue` — Delivery reliability of subcontractors
- `factory_get_fb_queue` — Orders queued by subcontractor
- `factory_get_fb_versand` — Orders ready for shipment to subcontractor
- `factory_get_fb_wareneingang` — Orders with expected goods receipt from subcontractor
**Patterns:**
- Subcontractor risk → `factory_get_fb_liefertreue` + `factory_get_fb_bewertung`, flag unreliable ones
- Subcontracting status → `factory_get_fb_auftraege` for overview, then drill into queues

## Tool Management (TMS)
**When:** Cutting tools, tool wear, tool changes, setup/changeover
**Tools:**
- `tms_get_status` — Status of all tools: wear, location, availability
- `tms_get_critical` — Tools with critical wear (>80%)
- `tms_get_machine_tools` — Tools currently mounted on a machine
- `tms_get_tools_for_article` — Required tool types for an article
- `tms_check_tool_availability` — Check if a machine has all tools for an article
- `tms_get_tool_changes` — What tools must be swapped for a changeover + extra setup time
- `tms_get_replacements` — Available replacement tools for a tool type
- `tms_get_history` — Recent tool usage and changes
- `tms_replace_tool` — ACTION: Replace a worn tool on a machine (auto-selects best replacement)
**Patterns:**
- Preventive tool change → `tms_get_critical` (>80% wear), then `tms_get_replacements` to find spares
- Changeover planning → `tms_get_tool_changes` to see what's needed + `tms_check_tool_availability`

## Assembly (Montage)
**When:** Assembly lines, pre-assembly, test field, assembly OEE, assembly tools
**Tools:**
- `montage_get_oee` — OEE of an assembly line
- `montage_get_bde` — BDE data: cycle times, good/bad parts, fault reasons
- `montage_get_prozessdaten` — Process parameters of an assembly station
- `montage_get_station_reliability` — MTBF, MTTR, availability per station
- `montage_get_station_tools` — Tools at an assembly station
- `montage_get_tms_status` — Assembly tool status: wear, availability
- `montage_get_critical_tools` — Assembly tools with critical wear (>80%)
- `montage_get_open_notifications` — Open fault notifications for assembly
- `montage_get_open_orders` — Open maintenance orders for assembly
- `montage_get_due_plans` — Due maintenance plans for assembly lines
- `montage_get_maintenance_summary` — Assembly maintenance overview
- `montage_get_tool_history` — Recent tool usage at assembly stations
- `montage_get_replacements` — Available replacement tools for assembly
- `montage_replace_tool` — ACTION: Replace assembly tool (auto-selects best)
- `montage_get_vormontage_status` — Pre-assembly cell status (VM-1, VM-2, VM-3)
- `montage_get_vormontage_oee` — Pre-assembly OEE
- `montage_get_vormontage_buffer` — Buffer levels between pre-assembly and main lines
- `montage_get_vormontage_wartung` — Pre-assembly maintenance status
- `montage_get_prueffeld_status` — Test field status (function test, leak test, burn-in)
- `montage_get_prueffeld_queue` — Parts waiting in test field queue
- `montage_get_prueffeld_ergebnisse` — Pass/fail rates of test field
- `montage_get_prueffeld_fehleranalyse` — Failure analysis by type and product
**Patterns:**
- Assembly performance → `montage_get_oee` + `montage_get_bde` per line
- Assembly bottleneck → `montage_get_vormontage_buffer` (is pre-assembly feeding fast enough?) + `montage_get_prueffeld_queue` (is test field backing up?)

## Injection Molding (Spritzguss)
**When:** Injection molding process, cavity balance, process drift, mold parameters
**Tools:**
- `sgm_get_process_data` — All ~97 process parameters (temperatures, pressures, speeds, positions)
- `sgm_get_process_trend` — Trend of a single parameter over time (drift detection)
- `sgm_get_cavity_balance` — Cavity pressure distribution (detects uneven filling from worn hot runner needles)
- `sgm_get_cavity_trend` — Trend for a single cavity (temperature, pressure)
- `sgm_get_hourly_aggregates` — Hourly averages, shot count, scrap rate
**Patterns:**
- Process drift → `sgm_get_process_trend` for key parameters, flag gradual changes
- Cavity problem → `sgm_get_cavity_balance` first, then `sgm_get_cavity_trend` for the bad cavity

## Knowledge Graph (Strategic Analysis)
**When:** Impact analysis, what-if scenarios, supply chain risk, dependencies, traceability, cross-domain connections
**Tools:**
- `kg_impact_analysis` — What's affected if an entity fails? Works for machines, suppliers, materials, tools
- `kg_what_if_machine_down` — Simulation: which orders need rescheduling if a machine goes down?
- `kg_dependency_graph` — All direct/indirect dependencies of a machine
- `kg_bottleneck_analysis` — Nodes with most connections = critical points
- `kg_critical_path_orders` — Orders with riskiest supply chain (single-source, high load, near due date)
- `kg_customer_delivery_risk` — Risk score 0-100 per customer: single-source deps, machine load, due dates
- `kg_supply_chain_risk` — Single-point-of-failure suppliers: how many orders/customers affected
- `kg_supplier_herfindahl` — Concentration index per material (HHI > 0.25 = high concentration)
- `kg_cluster_analysis` — Isolated subgraphs: articles depending on single machine/supplier/customer
- `kg_find_alternatives` — Alternative machines or suppliers for an article/material
- `kg_rerouting_options` — Rerouting options for a specific order: alternative machines with current load
- `kg_material_shortage_impact` — Full impact chain when a material is unavailable
- `kg_material_commonality` — Most shared materials across articles (critical if scarce)
- `kg_material_traceability` — Which orders consumed which material batches from which supplier
- `kg_lot_genealogy` — Full origin chain of a production lot (raw material → finished part)
- `kg_order_batch_similarity` — Orders with similar supply chains (useful for batch planning)
- `kg_shortest_path` — Shortest path between any two entities in the factory graph
- `kg_trace_order` — Full supply chain trace of an order: machine, material, suppliers, customer (3 levels deep)
- `kg_oee_vs_target` — Compare actual OEE vs. target per machine type
- `kg_kpi_dashboard` — KPI definitions with targets and actual status per machine type
- `kg_type_overview` — Machine type hierarchy: types, instances, target KPIs
- `kg_equipment_topology` — Equipment hierarchy: Site → Area → Machines (ISA-95)
- `kg_energy_efficiency` — Energy efficiency: consumption per machine, base load vs. production load
- `kg_energy_hotpath` — Most resource-intensive production paths (cycle time × order volume)
- `kg_pool_demand_forecast` — Demand per machine pool from open orders (capacity needed from cycle + setup time)
- `kg_procurement_status` — Open POs and their production impact: which orders wait for material?
- `kg_quality_impact` — Quality notifications impact on orders and customers
- `kg_maintenance_risk` — Maintenance risk: open orders per machine, overdue dates, downtime history
- `kg_subcontracting_risk` — Subcontracting risks: delivery reliability and quality per subcontractor
- `kg_tool_wear_cascade` — Cascade effect when a tool type is worn: affected articles, machines, orders
**Patterns:**
- Machine failure impact → `kg_what_if_machine_down` + `kg_find_alternatives` + `kg_rerouting_options`
- Supply chain risk assessment → `kg_supply_chain_risk` + `kg_supplier_herfindahl` + `kg_cluster_analysis`
- Cross-domain question → combine KG tools with domain-specific factory tools for complete picture

## History & Trends (Time-Series)
**When:** Historical data, trends over time, anomalies, machine comparison over time, "how did X change", drift detection, time-series queries
**Tools:**
- `history_get_trend` — Time-series for a variable of a machine (e.g. OEE of CNC-01 over last 24h)
- `history_compare` — Compare a variable between two machines in the same period
- `history_aggregate` — Aggregated values (AVG, MIN, MAX) per hour/day/week
- `history_anomalies` — Find values that deviate more than N sigma from the mean
- `history_machines` — List all machines with data in the historian (with data point counts)
- `history_variables` — List all variables for a machine (with last value)
**Patterns:**
- Trend analysis → `history_get_trend` for the variable, then `history_aggregate` for daily summaries
- Anomaly detection → `history_anomalies` to find outliers, then `history_get_trend` to see the full context
- Machine comparison → `history_compare` for side-by-side, then `history_aggregate` for both
- "What machines are reporting?" → `history_machines` for overview, then `history_variables` per machine

## Sensor Discovery (KG Auto-Discovery)
**When:** What machines/sensors exist, what is connected, live topology, UNS structure, auto-discovered devices
**Tools:**
- `kg_discovered_machines` — All machines auto-discovered from MQTT UNS (with sensor count and last seen)
- `kg_machine_sensors` — All sensors of a machine with last value, unit, category
**Patterns:**
- Factory topology → `kg_discovered_machines` for machine list, then `kg_machine_sensors` per machine for detail
- Combine with history → `kg_machine_sensors` to find variable names, then `history_get_trend` for time-series

## Cross-Domain Patterns
- "Why is customer X unhappy?" → `factory_get_customer_otd` + `factory_get_orders_at_risk` + `factory_get_quality_notifications` + `kg_customer_delivery_risk`
- "Create a shift report" → `factory_get_latest_oee` + `factory_get_production_history` + `factory_get_scrap_history` + `factory_get_downtime_report` + `factory_get_blocked_orders_count` + `factory_get_spc_alarms`
- "What's our biggest risk right now?" → `kg_bottleneck_analysis` + `kg_supply_chain_risk` + `factory_get_orders_at_risk` + `factory_get_low_stock_items` + `tms_get_critical`
- "Optimize production for next week" → `factory_get_capacity_overview` + `factory_get_orders_at_risk` + `factory_get_material_coverage` + `factory_get_machine_pool_members` + `kg_pool_demand_forecast`
- "How did machine X perform this week?" → `history_get_trend` (OEE) + `history_aggregate` (daily) + `factory_get_machine_oee` (current) + `history_anomalies` (outliers)
- "What sensors are on this machine?" → `kg_machine_sensors` + `history_variables` for full picture with time-series
