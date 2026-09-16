const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const board = JSON.parse(fs.readFileSync('client/public/data/latest.json', 'utf8'));
const keys = ['green', 'yellow', 'red', 'stale', 'unknown'];
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/rest/v1/rpc/**', r => r.abort());
    await page.goto(process.env.SUMMARY_TEST_URL || 'http://127.0.0.1:5173');
    await page.locator('.summary-scope').waitFor();
    async function verify(stations) {
      const counts = Object.fromEntries(keys.map(k => [k, stations.filter(s => s.signal === k).length]));
      assert.equal(Object.values(counts).reduce((a,b) => a+b,0), stations.length);
      for (const k of keys) {
        assert.equal(await page.locator(`.stat-${k} .stat-value`).innerText(), `${counts[k]}곳`);
        assert.equal((await page.locator(`.stat-${k} .stat-percent`).innerText()).trim(), `· ${stations.length ? (counts[k]/stations.length*100).toFixed(2) : '0.00'}%`);
      }
      assert.ok((await page.locator('.summary-scope').innerText()).includes(`${stations.length}곳`));
      return counts;
    }
    console.log(board.date, await verify(board.stations));
    await page.locator('.stat-stale').click();
    await verify(board.stations);
    assert.equal(await page.locator('.stat-stale').getAttribute('aria-pressed'), 'true');
    await page.locator('.stat-stale').click();
    const input = page.getByPlaceholder('검색', {exact:true});
    await input.fill('과거미신고');
    await verify(board.stations.filter(s => s.signal === 'stale'));
    await input.fill('없는주유소검증000');
    await verify([]);
    await input.fill('');
    await verify(board.stations);
    await page.locator('.stat-cancel').click();
    await verify(board.stations);
    await page.locator('.stat-cancel').click();
    for (const width of [1920, 1440, 390, 320]) {
      await page.setViewportSize({width, height:1000});
      for (const k of keys) {
        const b = await page.locator(`.stat-${k}`).boundingBox();
        const n = await page.locator(`.stat-${k} .stat-numbers`).boundingBox();
        assert.ok(b.x >= 0 && b.x+b.width <= width+1, `${width} ${k} card overflow`);
        assert.ok(n.x+n.width <= b.x+b.width+1, `${width} ${k} numbers overflow`);
      }
    }
    // A valid dataset with no stale stations must still show its zero card.
    const noStale = {...board, stations:board.stations.filter(s => s.signal !== 'stale')};
    await page.route('**/latest.json*', r => r.fulfill({json:noStale}));
    await page.reload();
    await page.locator('.summary-scope').waitFor();
    await verify(noStale.stations);
    console.log('PASS: counts, percentages, search, empty results, toggles, overlap, responsive bounds, stale zero/nonzero');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
