import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  const html = await page.content();
  console.log("ERRORS:", errors);
  console.log("HTML:", html.substring(0, 500));
  await browser.close();
})();
