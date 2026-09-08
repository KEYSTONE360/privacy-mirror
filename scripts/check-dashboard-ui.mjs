import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/connection.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.PMDashboardConnection={runtime:{sendMessage:async m=>m.type==='PM_CONNECT_DASHBOARD'?{ok:true}:m.type==='PM_GET_HISTORY'?{history:{sites:{'synthetic.example':{hours:{[Math.floor(Date.now()/3600000)*3600000]:{total:10,risk:200,confidence:150,outcomes:{defended:0,perturbed:2,cleaned:1,blocked:1},access:{dangerous:2,suspicious:4,benign:4},categories:{canvas:6,network:4}}}}}}}:{report:{site:'synthetic.example',riskScore:40,eventCount:10,events:[],graph:{nodes:[],edges:[]},recommendation:{selected:[],projectedRisk:40}}}}};` }));
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/dashboard/index.html');
  await page.waitForFunction(() => document.getElementById('defense-rate').textContent === '40%');
  assert.match(await page.locator('#site-table').innerText(), /4\/10 \(40%\)/);
  assert.match(await page.locator('#hour-table').innerText(), /4\/10 \(40%\)/);
  await page.locator('#sites').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.waitForFunction(() => document.querySelector('.line-sidebar__item[aria-current="true"]')?.textContent.includes('사이트별'));
  await page.locator('#ai-review').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.waitForFunction(() => document.querySelector('.line-sidebar__item[aria-current="true"]')?.textContent.includes('AI 종합'));
  await page.locator('#overview').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await mkdir('outputs', { recursive: true });
  await page.screenshot({ path: 'outputs/dashboard-fixture-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'outputs/dashboard-fixture-mobile.png' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  assert.equal(overflow, false, 'mobile page must not overflow horizontally');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ fixtureUI: true, defenseRate: '40%', tableCounts: '4/10', scrollSync: true, mobileOverflow: false, errors }));
} finally { await browser.close(); }
