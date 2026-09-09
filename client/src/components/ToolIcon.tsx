/** Lightweight inline toolbar icons: no icon package or external asset fetch. */
export default function ToolIcon({ kind }: { kind: "download" | "rank" | "mean" }) {
  const paths = {
    download: "M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4",
    rank: "M5 20V10m7 10V4m7 16v-7",
    mean: "M4 4h16v16H4zM4 10h16M10 10v10",
  };
  return <svg className="tool-icon" viewBox="0 0 24 24" fill="none" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}
