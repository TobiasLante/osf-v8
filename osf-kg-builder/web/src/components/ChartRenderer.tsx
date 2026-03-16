'use client';

import React, { useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

/**
 * ChartRenderer — renders LLM-generated recharts configurations.
 *
 * NOTE: ChartConfig mirrors the backend type in src/chart-engine.ts.
 * Keep both in sync when modifying.
 */

export interface ChartConfig {
  type: 'bar' | 'line' | 'pie' | 'area' | 'scatter';
  title: string;
  xAxis: string;
  yAxis: string;
  data: Record<string, any>[];
  colors?: string[];
  stacked?: boolean;
}

interface Props {
  config: ChartConfig;
  height?: number;
  className?: string;
}

const COLORS = ['#10b981', '#8b5cf6', '#3b82f6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#84cc16'];

const TOOLTIP_STYLE = { backgroundColor: '#141418', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 };

export default function ChartRenderer({ config: cfg, height = 400, className }: Props) {
  const colors = useMemo(() => cfg.colors?.length ? cfg.colors : COLORS, [cfg.colors]);

  if (!cfg.data?.length) {
    return <div className={className} style={{ padding: 16 }}><p className="text-[var(--text-dim)] text-sm text-center">No data available</p></div>;
  }

  const chart = useMemo(() => {
    const grid = <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />;
    const xAxis = <XAxis dataKey={cfg.xAxis} stroke="#71717a" tick={{ fontSize: 11, fill: '#a1a1aa' }} />;
    const yAxis = <YAxis stroke="#71717a" tick={{ fontSize: 11, fill: '#a1a1aa' }} />;
    const tooltip = <Tooltip contentStyle={TOOLTIP_STYLE} />;
    const legend = <Legend wrapperStyle={{ fontSize: 12 }} />;

    switch (cfg.type) {
      case 'bar':
        return (
          <BarChart data={cfg.data}>{grid}{xAxis}{yAxis}{tooltip}{legend}
            <Bar dataKey={cfg.yAxis} stackId={cfg.stacked ? 'stack' : undefined} radius={[4, 4, 0, 0]}>
              {cfg.data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            </Bar>
          </BarChart>
        );
      case 'line':
        return (
          <LineChart data={cfg.data}>{grid}{xAxis}{yAxis}{tooltip}{legend}
            <Line type="monotone" dataKey={cfg.yAxis} stroke={colors[0]} strokeWidth={2} dot={{ fill: colors[0], r: 3 }} />
          </LineChart>
        );
      case 'area':
        return (
          <AreaChart data={cfg.data}>{grid}{xAxis}{yAxis}{tooltip}{legend}
            <Area type="monotone" dataKey={cfg.yAxis} stroke={colors[0]} fill={colors[0]} fillOpacity={0.15} />
          </AreaChart>
        );
      case 'pie':
        return (
          <PieChart>{tooltip}{legend}
            <Pie data={cfg.data} dataKey={cfg.yAxis} nameKey={cfg.xAxis} cx="50%" cy="50%" outerRadius={height / 3} label={({ name, value }) => `${name}: ${value}`} labelLine={{ stroke: '#71717a' }}>
              {cfg.data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            </Pie>
          </PieChart>
        );
      case 'scatter':
        return (
          <ScatterChart>{grid}
            <XAxis dataKey={cfg.xAxis} name={cfg.xAxis} stroke="#71717a" tick={{ fontSize: 11, fill: '#a1a1aa' }} />
            <YAxis dataKey={cfg.yAxis} name={cfg.yAxis} stroke="#71717a" tick={{ fontSize: 11, fill: '#a1a1aa' }} />
            {tooltip}<Scatter data={cfg.data} fill={colors[0]} />
          </ScatterChart>
        );
      default:
        return <div className="text-[var(--text-dim)] text-center">Unknown chart type: {cfg.type}</div>;
    }
  }, [cfg, colors, height]);

  return (
    <div className={className} style={{ width: '100%' }}>
      {cfg.title && <h3 className="text-center text-sm font-medium text-[var(--text-muted)] mb-4">{cfg.title}</h3>}
      <ResponsiveContainer width="100%" height={height}>{chart}</ResponsiveContainer>
    </div>
  );
}
