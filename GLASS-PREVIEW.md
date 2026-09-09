# Soft Glass UI preview

Isolated branch: `codex/mac-glass-ui`. Based on main commit `425debf`.

## Preview

```powershell
npm ci
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Open http://127.0.0.1:5174/ on this laptop.
The original workspace and production Pages site are not changed.
Do not merge or dispatch a Pages deployment until the user approves this design.

## Scope

- K-Petro logo, green identity, and all signal colors preserved.
- Frosted toolbar, sage canvas, rounded opaque data panels and unified controls.
- Original filtering, search syntax/help, sorting, full CSV export, map drilldown,
  zoom/pan, rank/mean validation, cancellation report, three charts, admin and
  mobile fullscreen sheets retained.
- No price data, judging logic, SQL, API or dependency changes.
- Virtualized rows, batched name sizing and guide-only divider drag retained.
- Initial map width 32%; experimental localStorage key gs.glass.mapFraction.
- Only toolbar uses blur. Tables and maps have no backdrop filtering.

The preview can read the existing public judging settings; admin is the original
working admin, not a sandbox database. Do not save settings simply to test styling.

## Verification

```powershell
npm run check
npx tsx --test scripts/regression.test.ts scripts/region-policy.test.ts
npm run build
# With the local preview server already running:
node scripts/glass-ui.test.cjs
```

The browser smoke test intercepts DB RPCs and never writes to the shared database.
It verifies five filters, query search, 472-station CSV, fuel switching,
rank/mean windows, divider keyboard control, Seoul drilldown, zoom controls,
all three charts, cancellation report and mobile fullscreen map/list.
Responsive screenshots: .tmp/preview/ (1920, 1440, 390px).
