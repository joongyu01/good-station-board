/**
 * 지도 칸과 목록 칸의 폭을 사용자가 끌어서 조절한다.
 *
 * 두 칸에 필요한 폭은 보는 사람마다 다르다. 지도를 크게 놓고 위치를 보는
 * 사람도 있고, 목록의 가격·계수·순위를 나란히 놓고 읽는 사람도 있다.
 * 고정 비율로는 어느 한쪽이 늘 좁다 — 실제로 시·군·구 단계에서 상호가 긴
 * 주유소가 있으면 목록이 가로로 잘렸다.
 *
 * 비율은 브라우저에 저장한다. 이 사람의 이 브라우저에서만 쓰는 값이라
 * 서버에 올릴 이유가 없다. 저장이 막혀 있어도(사생활 보호 창 등) 기본값으로
 * 그냥 동작해야 한다.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "gs.mapFraction";

/** 지도 칸이 차지하는 기본 비율. */
const DEFAULT_FRACTION = 0.58;

/** 어느 쪽도 이보다 좁아지지 않는다. 지도는 축척이, 표는 열이 무너진다. */
const MIN_FRACTION = 0.3;
const MAX_FRACTION = 0.78;

/** 이 폭 아래에서는 한 줄로 쌓이므로 분할선이 의미가 없다. styles.css 와 같은 값. */
const STACK_WIDTH = 1240;

/** 키보드로 조절할 때 한 번에 움직이는 폭. */
const KEY_STEP = 0.02;

function clamp(v: number): number {
  return Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, v));
}

function load(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_FRACTION;
    const v = Number(raw);
    return Number.isFinite(v) ? clamp(v) : DEFAULT_FRACTION;
  } catch {
    return DEFAULT_FRACTION;
  }
}

function save(v: number) {
  try { localStorage.setItem(KEY, String(v)); } catch { /* 저장 못 해도 그만이다 */ }
}

interface Props {
  left: React.ReactNode;
  right: React.ReactNode;
}

export default function SplitLayout({ left, right }: Props) {
  const [fraction, setFraction] = useState(load);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLElement | null>(null);

  // 끌기가 끝났을 때만 저장한다. 움직이는 내내 쓰면 낭비다.
  useEffect(() => { if (!dragging) save(fraction); }, [dragging, fraction]);

  const fromX = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    setFraction(clamp((clientX - rect.left) / rect.width));
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // 분할선은 얇아서 포인터가 쉽게 벗어난다. 여기서는 바로 캡처해도 된다 —
    // 지도 폴리곤과 달리 이어지는 click 을 받을 대상이 없다.
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    fromX(e.clientX);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") setFraction((f) => clamp(f - KEY_STEP));
    else if (e.key === "ArrowRight") setFraction((f) => clamp(f + KEY_STEP));
    else if (e.key === "Home") setFraction(DEFAULT_FRACTION);
    else return;
    e.preventDefault();
  }

  return (
    <main
      ref={ref}
      className={`layout${dragging ? " is-resizing" : ""}`}
      style={{ ["--map-col" as string]: `${(fraction * 100).toFixed(2)}%` }}
    >
      <section className="map-col">{left}</section>

      <div
        className="layout-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="지도와 목록 폭 조절"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={Math.round(MIN_FRACTION * 100)}
        aria-valuemax={Math.round(MAX_FRACTION * 100)}
        tabIndex={0}
        title="끌어서 폭 조절 · 두 번 누르면 기본값"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setFraction(DEFAULT_FRACTION)}
        onKeyDown={onKeyDown}
      >
        <span className="layout-grip" aria-hidden="true" />
      </div>

      <section className="panel-col">{right}</section>
    </main>
  );
}

export { STACK_WIDTH };
