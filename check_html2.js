import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  const html = await page.innerHTML('#root');
  console.log("ROOT:", html.substring(0, 500));
  await browser.close();
})();
