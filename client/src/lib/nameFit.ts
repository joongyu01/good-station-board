/** 이름 크기 측정은 모든 쓰기/읽기를 묶어 강제 레이아웃 반복을 피한다. */
const pending = new Set<HTMLButtonElement>();
let paused = false;
let frame = 0;
function schedule() {
  if (paused || frame || !pending.size) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (paused) return;
    let remaining = [...pending].filter(el => el.isConnected);
    pending.clear();
    for (const [size, spacing] of [[13, -.02], [12, -.04], [11, -.06]]) {
      for (const el of remaining) {
        el.style.whiteSpace = 'nowrap';
        el.style.fontSize = `${size}px`;
        el.style.letterSpacing = `${spacing}em`;
      }
      remaining = remaining.filter(el => el.scrollWidth > el.clientWidth + 1);
    }
    for (const el of remaining) el.style.whiteSpace = 'normal';
  });
}
export function pauseNameFit() { paused = true; }
export function resumeNameFit() { paused = false; schedule(); }
export function observeNameFit(el: HTMLButtonElement) {
  let width = -1;
  const observer = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width === width) return;
    width = entry.contentRect.width;
    pending.add(el);
    schedule();
  });
  observer.observe(el);
  pending.add(el);
  schedule();
  return () => { observer.disconnect(); pending.delete(el); };
}
