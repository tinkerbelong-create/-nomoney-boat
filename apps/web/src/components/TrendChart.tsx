'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

export function TrendChart({ data }: { data: { month: string; profit: number }[] }) {
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <ReferenceLine y={0} stroke="#cbd5e1" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fill: '#6b7785' }}
            tickFormatter={(v: string) => v.slice(5) + '月'}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#6b7785' }}
            tickFormatter={(v: number) =>
              Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : String(v)
            }
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            formatter={(v: number) => [`${v.toLocaleString()}pt`, '収支']}
            labelFormatter={(l: string) => l}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e3e8ee' }}
          />
          <Line
            type="monotone"
            dataKey="profit"
            stroke="#0f1720"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
