import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
const warnings = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
  if (msg.type() === 'warning') warnings.push(msg.text());
});
page.on('pageerror', (err) => errors.push('PAGEERROR: ' + String(err)));
page.on('requestfailed', (req) => errors.push('REQUEST FAILED: ' + req.url() + ' - ' + req.failure()?.errorText));

console.log('=== 1. Mumbai Overview (fresh load) ===');
await page.goto('http://localhost:5200/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'audit_01_overview.png' });

console.log('=== 2. Enter Kurla-Sion zone ===');
await page.getByText('Kurla–Sion', { exact: false }).first().click();
await page.waitForTimeout(3000);
await page.screenshot({ path: 'audit_02_zone_situation.png' });

console.log('=== 3. Impact tab ===');
await page.getByText('Impact', { exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'audit_03_impact.png' });

console.log('=== 4. Response & Routing tab ===');
await page.getByText('Response & Routing').click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'audit_04_response.png' });

console.log('=== 5. Simulation tab ===');
await page.getByText('Simulation', { exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'audit_05_simulation.png' });

console.log('=== 6. Switch to Hindmata-Dadar zone ===');
await page.getByText('Situation', { exact: true }).click();
await page.getByText('Hindmata', { exact: false }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: 'audit_06_hindmata.png' });

console.log('=== 7. Reference modals ===');
await page.getByText('Analytics', { exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'audit_07_analytics.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await page.getByText('Data Provenance', { exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'audit_08_provenance.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await page.getByText('Validation Log', { exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'audit_09_validation.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await page.getByText('Methodology & Evidence', { exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'audit_10_methodology.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

console.log('=== 8. Citizen View ===');
await page.getByText('Citizen View').click();
await page.waitForTimeout(2500);
await page.screenshot({ path: 'audit_11_citizen.png' });

console.log('=== 9. Back to Command, System Status dropdown ===');
await page.getByText('Command', { exact: true }).click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'System Status' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'audit_12_systemstatus.png' });

console.log('\n=== ERRORS (' + errors.length + ') ===');
errors.forEach(e => console.log(e));
console.log('\n=== WARNINGS (' + warnings.length + ') ===');
warnings.forEach(w => console.log(w));

await browser.close();
