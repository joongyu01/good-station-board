// Read-only smoke test of the isolated design. Start Vite on 5174 first.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const url = process.env.GLASS_TEST_URL || 'http://127.0.0.1:5174';
(async () => {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1920,height:1080}});
  // Keep QA isolated from the shared DB. Never save admin settings during this test.
  await context.route('**/rest/v1/rpc/**', route => {
    if (route.request().url().includes('gs_judging')) return route.fulfill({
      contentType:'application/json', body:JSON.stringify({
        rankGreenMetro:10,rankGreenDefault:5,rankYellowFactor:2,judgeMode:'rank',
        adjustedCombine:'both',driftGreen:0,driftYellow:.01,
      }),
    });
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e=>errors.push(e.message));
  fs.mkdirSync('.tmp/preview', {recursive:true});
  await page.goto(url);
  await page.waitForSelector('.station-table .name-link');
  await page.waitForTimeout(400);
  assert.ok(await page.locator('.name-link').count() < 60, 'virtual list preserved');
  assert.equal(await page.locator('button.stat').count(), 5);
  assert.equal(await page.locator('.topbar .brand .station-total-link').count(), 1);
  assert.equal(await page.locator('.page > .station-total-link').count(), 0);
  await page.locator('.stat-green').hover();
  assert.ok(await page.locator('#signal-help-green').isVisible());
  assert.match(await page.locator('#signal-help-green').innerText(),/순위/);
  const statsEvent=page.waitForEvent('popup');
  await page.locator('.station-total-link').click();
  const stats=await statsEvent;
  await stats.getByRole('heading',{name:'착한주유소 통계',exact:true}).waitFor();
  assert.equal(await stats.locator('.stats-panel').count(),7);
  assert.equal(await stats.locator('.stats-page > :last-child').getAttribute('class'),'stats-panel region-price-stats');
  await stats.locator('.region-price-scroll tbody tr').first().waitFor();
  assert.equal(await stats.locator('.region-price-scroll tbody tr').count(),32);
  assert.equal(await stats.locator('.region-price-scroll tbody th').count(),16);
  assert.deepEqual((await stats.locator('.region-price-scroll tbody th').allTextContents()).slice(0,3),['서울','경기','인천']);
  assert.equal(await stats.locator('.good-price-scroll tbody th').count(),16);
  assert.match(await stats.locator('.good-price-scroll').innerText(),/절감률/);
  await stats.getByLabel('가격 기준일').selectOption('20260630');
  assert.equal(await stats.locator('.region-price-scroll tbody tr').count(),34);
  await stats.getByLabel('유종',{exact:true}).selectOption('gasoline');
  assert.equal(await stats.locator('.region-price-scroll tbody tr').count(),17);
  assert.match(await stats.locator('.stats-kpis').innerText(),/472/);
  await stats.screenshot({path:'.tmp/preview/station-stats.png',fullPage:true});
  await stats.close();
  for (let i=0;i<5;i++) {
    const filter=page.locator('button.stat').nth(i);
    await filter.click();
    assert.equal(await filter.getAttribute('aria-pressed'), 'true');
    await filter.click();
  }
  const search=page.getByRole('combobox',{name:'주유소 검색'});
  await search.fill('착하디착한');
  await page.getByRole('listbox').waitFor();
  assert.ok(await page.getByRole('option').count() <= 8);
  await page.screenshot({path:'.tmp/preview/search-preview.png'});
  await search.press('ArrowDown');
  await search.press('Enter');
  await page.waitForSelector('.chart-svg');
  await page.keyboard.press('Escape');
  await search.click();
  await page.getByRole('option').first().click();
  await page.waitForSelector('.chart-svg');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.ok(await page.locator('.badge-loyal').count()>0);
  await search.fill('이름없는검증문자열0000');
  await page.waitForSelector('.empty');
  await search.fill('');
  await page.waitForSelector('.name-link');
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'CSV 내려받기',exact:true}).click();
  const download=await downloadEvent;
  const stream=await download.createReadStream();
  let csv=''; for await (const chunk of stream) csv+=chunk.toString();
  assert.equal(csv.trim().split(/\r?\n/).length, 473, 'all stations exported, not only visible rows');
  await page.getByRole('tab',{name:'휘발유',exact:true}).click();
  assert.equal(await page.getByRole('tab',{name:'휘발유',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'통합',exact:true}).click();
  await page.getByRole('button',{name:'순위표 검증',exact:true}).click();
  await page.waitForSelector('.rank-table tbody tr');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'단위지역 평균가격 검증',exact:true}).click();
  await page.waitForSelector('.mean-table tbody tr');
  assert.equal(await page.locator('.mean-table tbody tr').count(),16);
  await page.locator('.mean-report select').selectOption('20260630');
  assert.equal(await page.locator('.mean-table tbody tr').count(),17);
  assert.match(await page.locator('.mean-table thead').innerText(),/휘발유 평균/);
  assert.match(await page.locator('.mean-table thead').innerText(),/경유 평균/);
  await page.screenshot({path:'.tmp/preview/mean-verification.png'});
  await page.keyboard.press('Escape');
  const sep=page.getByRole('separator');
  const previous=Number(await sep.getAttribute('aria-valuenow'));
  await sep.focus(); await page.keyboard.press('ArrowRight');
  assert.equal(Number(await sep.getAttribute('aria-valuenow')),previous+2);
  await page.getByRole('button',{name:'한국석유관리원 — 처음 화면으로'}).click();
  await page.locator('.region-label').filter({hasText:'서울'}).first().click();
  await page.waitForTimeout(200);
  assert.ok((await page.locator('.breadcrumb').first().innerText()).includes('서울'));
  const data=JSON.parse(fs.readFileSync('client/public/data/latest.json','utf8'));
  const seoul=data.stations.filter(s=>s.sido==='서울');
  for(const signal of ['green','yellow','red','unknown','cancel']) {
    const expected=seoul.filter(s=>signal==='cancel' ? s.overRegion?.cancel : s.signal===signal).length;
    assert.equal(Number(await page.locator('.stat-'+signal+' .stat-value').innerText()),expected,'scoped '+signal);
  }
  await page.locator('.region-label').filter({hasText:'노원구'}).first().click();
  const nowon=seoul.filter(s=>s.sigungu==='노원구');
  assert.equal(Number(await page.locator('.stat-red .stat-value').innerText()),nowon.filter(s=>s.signal==='red').length);
  assert.equal(Number(await page.locator('.stat-cancel .stat-value').innerText()),nowon.filter(s=>s.overRegion?.cancel).length);
  await page.getByRole('button',{name:'확대',exact:true}).click();
  await page.getByRole('button',{name:'축소',exact:true}).click();
  await page.getByRole('button',{name:'한국석유관리원 — 처음 화면으로'}).click();
  await page.locator('.name-link').first().click();
  await page.waitForSelector('.chart-svg');
  assert.equal(await page.locator('.chart-svg').count(),4);
  await page.screenshot({path:'.tmp/preview/station-detail.png'});
  const report=page.locator('.days-list').getByRole('button');
  if(await report.count()) {
    await report.click();
    await page.waitForSelector('.cancel-report[open]');
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Escape');
  for (const [width,height] of [[1920,1080],[1440,900],[390,844]]) {
    await page.setViewportSize({width,height});
    await page.waitForTimeout(450);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1), 'page fits viewport '+width);
    await page.screenshot({path:'.tmp/preview/glass-'+width+'.png',fullPage:true});
  }
  await page.getByRole('button',{name:'지도 전체화면으로 보기',exact:true}).click();
  await page.waitForSelector('.sheet');
  await page.locator('.sheet-close').click();
  await page.locator('.panel-more').click();
  await page.waitForSelector('.sheet');
  const mobileSearch=page.locator('.sheet').getByRole('combobox',{name:'주유소 검색'});
  await mobileSearch.fill('착하디착한');
  await page.locator('.sheet').getByRole('listbox').getByRole('option').first().click();
  await page.waitForSelector('.chart-svg');
  await page.locator('.chart-close').click();
  await page.locator('.sheet-close').click();
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('PASS: filters, search, 472-row CSV, modes, rank/mean windows, resizing, map, three charts, mobile sheets, responsive layout.');
})().catch(e=>{console.error(e);process.exit(1)});
