import { useEffect, useState } from "react";

/**
 * 좁은 화면(모바일)인지.
 *
 * styles.css 의 모바일 구간과 **같은 폭**을 쓴다. 둘이 어긋나면 CSS 는 카드로
 * 바뀌었는데 JS 는 아직 PC 로 판단하는 식의 어긋남이 생긴다.
 */
export const NARROW = "(max-width: 720px)";

export function useNarrow(query: string = NARROW): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);

  return narrow;
}
