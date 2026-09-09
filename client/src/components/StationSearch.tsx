import { useId, useState } from "react";
import { withBrand } from "@shared/lib/brand.ts";
import { QUERY_HINT } from "../lib/query.ts";
import { SIGNAL_COLORS, SIGNAL_LABELS, type StationSignal } from "../lib/board.ts";

/** Reuse the filtered/sorted list; only render eight suggestions, never all stations. */
export default function StationSearch({ value, onChange, rows, onSelect }: {
  value: string;
  onChange: (value: string) => void;
  rows: StationSignal[];
  onSelect: (station: StationSignal) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const suggestions = rows.slice(0, 8);
  const visible = open && !!value.trim();
  const current = active < suggestions.length ? active : -1;
  function choose(station: StationSignal) {
    setOpen(false);
    setActive(-1);
    onSelect(station);
  }
  return <div className="panel-search" onBlur={(e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  }}>
    <input type="search" role="combobox" value={value}
      aria-label="주유소 검색" aria-autocomplete="list"
      aria-expanded={visible} aria-controls={visible ? id : undefined}
      aria-activedescendant={visible && current >= 0 ? `${id}-${current}` : undefined}
      placeholder="검색"
      title={`검색 가이드\n${QUERY_HINT}\n낱말을 띄어 쓰면 모든 조건을 만족하는 주유소만 표시합니다.`}
      onFocus={() => setOpen(true)}
      onClick={() => setOpen(true)}
      onChange={(e) => { onChange(e.target.value); setActive(-1); setOpen(true); }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          if (visible) { e.stopPropagation(); setOpen(false); }
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault(); setOpen(true);
          if (suggestions.length) setActive(e.key === "ArrowDown"
            ? (current + 1) % suggestions.length
            : (current <= 0 ? suggestions.length - 1 : current - 1));
        }
        if (e.key === "Enter" && visible && current >= 0) {
          e.preventDefault(); choose(suggestions[current]);
        }
      }} />
    {value && <button type="button" className="search-clear" aria-label="검색 지우기"
      onClick={() => { onChange(""); setActive(-1); setOpen(false); }}>✕</button>}
    {visible && <div className="search-preview">
      <div className="search-preview-count" role="status">
        {rows.length ? `${rows.length}곳 중 ${suggestions.length}곳 미리보기 · 선택하면 상세정보` : "일치하는 주유소가 없습니다."}
      </div>
      <div id={id} role="listbox" aria-label="검색 결과 미리보기">
        {suggestions.map((station, i) => <button type="button" role="option"
          id={`${id}-${i}`} key={i} aria-selected={current === i}
          className="search-preview-option"
          onPointerDown={(e) => { if (e.pointerType === "mouse") e.preventDefault(); }}
          onClick={() => choose(station)}>
          <span className="search-preview-dot" style={{ background: SIGNAL_COLORS[station.signal] }} />
          <span className="search-preview-info"><strong>{withBrand(station.name, station.brand)}</strong>
            <small>{station.sido} {station.sigungu} · {SIGNAL_LABELS[station.signal]}</small></span>
        </button>)}
      </div>
    </div>}
  </div>;
}
