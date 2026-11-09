const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.SMARTTRACK_PLAYWRIGHT_PATH || path.join(os.tmpdir(), 'smarttrack-browser-tools/node_modules/playwright'));
const origin = new URL(process.env.BASE_URL || 'http://127.0.0.1:3104').origin;
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addInitScript(require("./contact-fixture.cjs").seedContact);
    await context.route('**/api/live', r => r.fulfill({status:401,contentType:'application/json',body:'{"error":"Private link required"}'}));
    await context.addInitScript(() => {
      window.__motion = {native:0,entry:0};
      const native=document.startViewTransition?.bind(document);
      if(native)document.startViewTransition=callback=>{window.__motion.native++;return native(callback);};
      const animate=Element.prototype.animate;
      Element.prototype.animate=function(...args){if(this.matches('[data-workspace-view]'))window.__motion.entry++;return animate.apply(this,args);};
    });
    const page=await context.newPage();page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const choose=async label=>{await page.locator('.sidebar').getByRole('link',{name:label,exact:true}).first().click();};
    await page.goto(origin+'/journeys');
    await choose('Navigation');await page.waitForURL(u=>u.pathname==='/navigation');
    await page.getByRole('heading',{name:'Choose a route first',exact:true}).waitFor();
    assert.equal(await page.getByRole('region',{name:'Journey planner',exact:true}).count(),0);
    assert.ok((await page.evaluate(()=>window.__motion)).native>=1);
    await page.goBack();await page.waitForURL(u=>u.pathname==='/journeys');
    await page.waitForFunction(()=>window.__motion.entry>=1);
    await page.evaluate(()=>{document.querySelector('.nav-item[href="/navigation"]').click();document.querySelector('.nav-item[href="/map"]').click();});
    await page.waitForURL(u=>u.pathname==='/map');
    await page.getByRole('heading',{name:'Live map',exact:true}).waitFor();
    await page.waitForFunction(()=>document.getAnimations().every(a=>!String(a.animationName||'').startsWith('workspace-plane')));
    assert.equal(new URL(page.url()).pathname,'/map','Rapid navigation must retain the most recent destination');
    assert.equal(await page.getByRole('region',{name:'Journey planner',exact:true}).count(),0);
    assert.equal(await page.getByRole('region',{name:'Trust Score',exact:true}).count(),0);
    const before=(await page.evaluate(()=>window.__motion)).native;
    await page.keyboard.press('Control+k');await page.getByRole('searchbox',{name:'Search workspace sections',exact:true}).fill('Navigation');await page.keyboard.press('Enter');
    await page.waitForURL(u=>u.pathname==='/navigation');
    assert.ok((await page.evaluate(()=>window.__motion)).native>before,'Keyboard search must use the same section transition');
    await page.emulateMedia({reducedMotion:'reduce'});
    const reduced=await page.evaluate(()=>({...window.__motion}));
    await choose('Journey');await page.waitForURL(u=>u.pathname==='/journeys');
    await page.goBack();await page.waitForURL(u=>u.pathname==='/navigation');
    assert.deepEqual(await page.evaluate(()=>window.__motion),reduced,'Reduced motion must suppress native and fallback section effects');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'passed',origin,checks:['Distinct tracking, planning and navigation views','Animated menu and keyboard section switches','Browser Back entrance animation','Rapid switches settle on the last destination','Reduced-motion navigation and clean browser runtime']},null,2));
    await context.close();
  } finally {await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
