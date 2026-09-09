import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { StationSignal } from "./board.ts";
import { useNarrow } from "./useNarrow.ts";

const ESTIMATE = 72;
const OVERSCAN = 8;
/** 표 밖의 전체 데이터는 그대로 두고 화면 근처의 행만 마운트한다. */
export function useVirtualStations(stations: StationSignal[]) {
  const table = useRef<HTMLTableElement>(null);
  const narrow = useNarrow();
  const enabled = !narrow && stations.length > 60;
  const [heights, setHeights] = useState<Record<number, number>>({});
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const offsets = useMemo(() => {
    const result = [0];
    for (let i = 0; i < stations.length; i++) result.push(result[i] + (heights[i] ?? ESTIMATE));
    return result;
  }, [stations, heights]);
  let start = 0, end = stations.length;
  if (enabled) {
    while (start < stations.length && offsets[start + 1] < viewport.top) start++;
    end = start;
    while (end < stations.length && offsets[end] < viewport.top + viewport.height) end++;
    start = Math.max(0, start - OVERSCAN);
    end = Math.min(stations.length, end + OVERSCAN);
  }

  useLayoutEffect(() => {
    setHeights({});
    const scroller = table.current?.closest<HTMLElement>(".panel-body, .sheet-body");
    if (!scroller || !enabled) return;
    scroller.scrollTop = 0;
    let frame = 0;
    const read = () => {
      frame = 0;
      const header = table.current?.tHead?.offsetHeight ?? 0;
      setViewport({ top: Math.max(0, scroller.scrollTop - header), height: scroller.clientHeight });
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(read); };
    // 화면 밖 높이는 추정치로 유지하고, 다시 보이는 행만 측정한다.
    // 폭 변경 때 전부 초기화하면 스크롤 위치가 크게 튄다.
    const resize = new ResizeObserver(queue);
    resize.observe(scroller);
    scroller.addEventListener("scroll", queue, { passive: true });
    read();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); scroller.removeEventListener("scroll", queue); };
  }, [stations, enabled]);

  useLayoutEffect(() => {
    if (!enabled || !table.current) return;
    const observer = new ResizeObserver(entries => {
      setHeights(previous => {
        const next = { ...previous };
        let changed = false;
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.rowIndex);
          const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
          if (height > 0 && Math.abs((next[index] ?? ESTIMATE) - height) > .5) {
            next[index] = height; changed = true;
          }
        }
        return changed ? next : previous;
      });
    });
    table.current.querySelectorAll("tbody tr[data-row-index]").forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [enabled, start, end, stations]);

  return { table, enabled, start, end, before: enabled ? offsets[start] : 0,
    after: enabled ? offsets[stations.length] - offsets[end] : 0 };
}
