/**
 * 모바일 전체화면 시트.
 *
 * 좁은 화면에서는 지도도 목록도 페이지 스크롤과 다툰다. 지도는 손가락 끌기를
 * 이동으로 먹어야 하고, 긴 목록은 자기 안에서 스크롤해야 하는데, 페이지도 같은
 * 동작으로 스크롤하려 드니 둘 중 하나는 반드시 진다.
 *
 * 그래서 본문에는 **보기만 하는 미리보기**를 두고, 누르면 이 시트를 띄워
 * 그 안에서만 조작하게 한다. 시트가 화면을 다 덮으므로 스크롤 주체가 하나다.
 */
import { useEffect, type ReactNode } from "react";

interface Props {
  /** 머리에 넣을 것 — 제목이든 드릴다운 경로든 */
  head: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  onClose: () => void;
  label: string;
  /** 본문이 스스로 스크롤할지. 지도는 아니고 목록은 그렇다. */
  scroll?: boolean;
}

export default function MobileSheet({ head, children, foot, onClose, label, scroll }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);

    // 시트가 떠 있는 동안 뒤 페이지가 같이 스크롤되면 닫았을 때 엉뚱한 곳에
    // 가 있다. 뒤를 묶어 둔다.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
      <header className="sheet-head">
        <div className="sheet-head-main">{head}</div>
        <button type="button" className="sheet-close" onClick={onClose} aria-label={`${label} 닫기`}>
          ✕
        </button>
      </header>
      <div className={`sheet-body${scroll ? " is-scroll" : ""}`}>{children}</div>
      {foot && <footer className="sheet-foot">{foot}</footer>}
    </div>
  );
}
