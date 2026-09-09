import { useState } from "react";

export interface DailyPlot {
  label: string;
  color: string;
  values: (number | null)[];
  format: (value: number) => string;
}

/** One hit surface per graph: dense daily points remain easy to inspect on mouse/touch. */
export default function ChartPoints({ dates, x, y, plots, width, bottom }: {
  dates: string[]; x: (index: number) => number; y: (value: number) => number;
  plots: DailyPlot[]; width: number; bottom: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const active = selected == null ? null : Math.min(selected, dates.length - 1);
  const tipWidth = Math.min(280, width - 64);
  const tipX = active == null ? 0 : Math.max(4, Math.min(width - tipWidth - 4, x(active) - tipWidth / 2));
  const text = (plot: DailyPlot, i: number) => plot.values[i] == null
    ? "미신고 · 값 없음" : plot.format(plot.values[i]!);
  return <g className="ch-daily-layer"
    onPointerMove={(event) => {
      const svg = event.currentTarget.ownerSVGElement!;
      const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
      const matrix = svg.getScreenCTM(); if (!matrix) return;
      const px = point.matrixTransform(matrix.inverse()).x;
      let nearest = 0;
      for (let i = 1; i < dates.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(nearest) - px)) nearest = i;
      setSelected(nearest);
    }}
    onPointerLeave={(e) => { if (e.pointerType === "mouse") setSelected(null); }}>
    <line x1={x(0)} x2={x(dates.length-1)} y1={bottom} y2={bottom} stroke="#d6ded8" />
    {plots.map((plot) => <g key={plot.label} data-series={plot.label}>
      {dates.map((date, i) => plot.values[i] == null
        ? <path key={date} className="ch-missing-point" stroke="#87918c" fill="none"
            d={`M${x(i)-2},${bottom-2}l4,4m-4,0l4,-4`}>
            <title>{date} · {plot.label}: 미신고 (0 아님)</title>
          </path>
        : <circle key={date} className="ch-daily-point" cx={x(i)} cy={y(plot.values[i]!)}
            r={1.65} fill={plot.color}><title>{date} · {plot.label}: {text(plot, i)}</title></circle>)}
    </g>)}
    <rect x={x(0)-4} y={0} width={Math.max(8, x(dates.length-1)-x(0)+8)} height={bottom+4}
      fill="transparent" tabIndex={0} role="slider" aria-label="일별 그래프 값 조회"
      aria-valuemin={1} aria-valuemax={dates.length} aria-valuenow={(active ?? 0)+1}
      aria-valuetext={active == null ? "방향키로 날짜 선택" : `${dates[active]} ${plots.map(p=>`${p.label} ${text(p,active)}`).join(', ')}`}
      onFocus={() => setSelected(0)} onBlur={() => setSelected(null)}
      onKeyDown={e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault(); setSelected(Math.max(0, Math.min(dates.length-1, (active ?? 0)+(e.key === "ArrowRight" ? 1 : -1))));
      } }} />
    {active != null && <g pointerEvents="none">
      <line x1={x(active)} x2={x(active)} y1={16} y2={bottom} stroke="#69756e" strokeDasharray="3 3" />
      {plots.map(plot => plot.values[active] != null && <circle key={plot.label}
        cx={x(active)} cy={y(plot.values[active]!)} r={3.2} fill={plot.color} stroke="white" />)}
      <g className="ch-value-tooltip" role="status" transform={`translate(${tipX}, 2)`}>
        <rect width={tipWidth} height={24+plots.length*17} rx={6} fill="#18251f" />
        <text x={10} y={16} fill="white" fontSize={11}>
          {dates[active].slice(0,4)}년 {Number(dates[active].slice(4,6))}월 {Number(dates[active].slice(6,8))}일
        </text>
        {plots.map((plot, i) => <text key={plot.label} x={10} y={33+i*17} fill="white" fontSize={11}>
          {plot.label}: {text(plot, active)}
        </text>)}
      </g>
    </g>}
  </g>;
}
