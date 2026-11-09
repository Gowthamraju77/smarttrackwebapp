/* UI interaction regression. All telemetry is synthetic; no hardware or secrets.
 * Run against an already-running build. REAL_MAP_TILES=1 checks OpenFreeMap too.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const { chromium } = require(process.env.SMARTTRACK_PLAYWRIGHT_PATH || path.join(os.tmpdir(), "smarttrack-browser-tools", "node_modules", "playwright"));
const baseUrl = new URL(process.env.BASE_URL || "http://127.0.0.1:3104").origin;
const realTiles = process.env.REAL_MAP_TILES === "1";
const publicLive = process.env.SMARTTRACK_PUBLIC_LIVE === "1";
const output = fs.mkdtempSync(path.join(os.tmpdir(), "smarttrack-spatial-ui-"));
const checks = [];
const screenshots = {};
const syntheticStartedAt = Date.now() - 1000;
const loaded = { exports: {} };
new Function("exports", "module", ts.transpileModule(fs.readFileSync(path.join(__dirname, "../lib/live/telemetry.ts"), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText)(loaded.exports, loaded);
const { TelemetryDecoder } = loaded.exports;
const visible = locator => locator.waitFor({ state: "visible" });
function nmea(body) { let checksum = 0; for (const c of body) checksum ^= c.charCodeAt(0); return `$${body}*${checksum.toString(16).padStart(2, "0")}\n`; }
function serialLines(now) {
  const date = new Date(now), two = value => String(value).padStart(2, "0");
  const clock = `${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}.${String(date.getUTCMilliseconds()).padStart(3,"0")}`;
  const day = `${two(date.getUTCDate())}${two(date.getUTCMonth()+1)}${two(date.getUTCFullYear()%100)}`;
  // Synthetic point in central Berlin for the optional map visualization test.
  return nmea(`GNRMC,${clock},A,5231.2000,N,01324.3000,E,1.5,90,${day},,,A`)
    + nmea(`GNGGA,${clock},5231.2000,N,01324.3000,E,1,12,1.0,12,M,0,M,,`)
    + 'MPU_SAMPLE {"ms":1000,"seq":1,"ax":-163,"ay":42,"az":8192,"gx":-11,"gy":8,"gz":3,"temp":1500}\n';
}
function feed(now) {
  const live = new TelemetryDecoder().push(serialLines(now), now);
  // Deliberate UI scenario: one observation in each supported quality category.
  live.trust.reasons = ["imu_unavailable", "gps_out_of_order", "nmea_checksum_error"];
  return { version:1, source:"esp32-serial", generatedAt:now, startedAt:syntheticStartedAt, receivedAt:now,
    serial:{port:"SYNTHETIC",baudRate:115200,connected:true,error:null}, live, capturedSnapshot:structuredClone(live),
    trajectory:[{latitude:52.5199,longitude:13.4049,receivedAt:now-1000,recordedAt:new Date(now-1000).toISOString()},{latitude:52.52,longitude:13.405,receivedAt:now,recordedAt:live.gps.recordedAt}] };
}
async function mapStub(context) {
  await context.route("https://tiles.openfreemap.org/styles/positron", route => route.fulfill({ contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body:JSON.stringify({version:8,sources:{},layers:[{id:"background",type:"background",paint:{"background-color":"#183c34"}}]}) }));
}
async function capture(page, name) { screenshots[name] = path.join(output, `${name}.png`); await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"})); await page.screenshot({path:screenshots[name],fullPage:true}); }
async function fits(page, width) {
  await page.setViewportSize({width,height:900});
  const size = await page.evaluate(() => ({content:document.documentElement.scrollWidth, viewport:innerWidth}));
  assert.ok(size.content <= size.viewport + 1, `Horizontal overflow at ${width}px: ${JSON.stringify(size)}`);
}
async function interactions(browser) {
  const context = await browser.newContext({viewport:{width:1440,height:1040}});
  await context.addInitScript(require("./contact-fixture.cjs").seedContact);
  if (!realTiles) await mapStub(context);
  let historical = false, latest = null;
  await context.route("**/api/live", route => {
    const now = Date.now();
    let data;
    if (historical) { data=structuredClone(latest); data.generatedAt=now; data.serial.connected=false; data.live=new TelemetryDecoder().snapshot(now); data.receivedAt=null; }
    else { data=feed(now); latest=structuredClone(data); }
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
  });
  const page = await context.newPage(); page.setDefaultTimeout(realTiles ? 45000 : 25000);
  const errors=[]; let tiles=0,style=false;
  page.on("pageerror", e=>errors.push(e.message));
  page.on("response", response=>{const u=new URL(response.url());if(u.hostname==="tiles.openfreemap.org"&&response.ok()){if(u.pathname==="/styles/positron")style=true;if(u.pathname.endsWith(".pbf"))tiles++;}});
  await page.goto(`${baseUrl}/#feed=synthetic_spatial_viewer_000000000000000`,{waitUntil:"domcontentloaded"});
  try { await visible(page.getByRole("img",{name:"Current ESP32 GPS fix",exact:true})); }
  catch(error) { await capture(page,"initial-map-failure"); throw new Error(`${error.message}; page errors: ${JSON.stringify(errors)}; map: ${await page.locator('[data-map-view]').innerText()}`); }
  const options=page.getByRole("button",{name:/Connection options/});
  assert.equal(await options.getAttribute("aria-expanded"),"false");
  await options.click();
  await visible(page.getByRole("button",{name:"Connect ESP32",exact:true}));
  await options.click();
  const panelId=await options.getAttribute("aria-controls");
  assert.equal(await page.locator(`[id="${panelId}"]`).getAttribute("inert"),"");
  const motion=page.getByRole("button",{name:/Inspect raw sensor readings/});
  assert.equal(await motion.getAttribute("aria-expanded"),"false");
  await motion.click();
  await visible(page.getByRole("region",{name:"Motion readings",exact:true}).getByText("-163",{exact:true}));
  await motion.click();
  checks.push("Expandable connection and sensor details preserve real controls and remove hidden content from the keyboard tab order");
  await capture(page,"dashboard-synthetic");

  const searchButton=page.getByRole("button",{name:"Search workspace sections",exact:true});
  await searchButton.click();
  const dialog=page.locator("#workspace-search");
  await visible(dialog); await page.getByRole("searchbox",{name:"Search workspace sections"}).fill("no such section xyz");
  assert.equal(await dialog.locator("[data-search-result]").count(),0);
  await page.keyboard.press("Escape");
  await dialog.waitFor({state:"hidden"});
  assert.equal(await searchButton.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press("Control+k");
  await visible(dialog);
  await page.getByRole("searchbox",{name:"Search workspace sections"}).fill("live map");
  await page.keyboard.press("Enter");
  await page.waitForURL(url=>url.pathname==="/map");
  await visible(page.getByRole("img",{name:"Current ESP32 GPS fix",exact:true}));
  checks.push("Search supports empty results, Escape with focus restoration, Ctrl+K, and Enter navigation to a real section");

  const mapFrame=page.locator("[data-map-view]");
  await visible(mapFrame);
  const mapSize=await page.locator('.maplibregl-map').evaluate(el=>({height:el.clientHeight,width:el.clientWidth,parentHeight:el.parentElement.clientHeight}));
  assert.ok(mapSize.height>300&&mapSize.width>250&&Math.abs(mapSize.height-mapSize.parentHeight)<=1,`Map canvas container must fill its frame: ${JSON.stringify(mapSize)}`);
  await page.getByRole("button",{name:"2D",exact:true}).click();
  assert.equal(await mapFrame.getAttribute("data-map-view"),"2d");
  await page.getByRole("button",{name:"3D",exact:true}).click();
  assert.equal(await mapFrame.getAttribute("data-map-view"),"3d");
  await page.getByRole("button",{name:"Zoom in",exact:true}).click();
  await visible(page.getByRole("button",{name:"Follow device",exact:true}));
  await page.getByRole("button",{name:"Follow device",exact:true}).click();
  assert.equal(await page.getByRole("button",{name:"Following device",exact:true}).getAttribute("aria-pressed"),"true");
  assert.equal(await page.getByRole("region",{name:"Journey planner",exact:true}).count(),0);
  assert.equal(await page.getByRole("region",{name:"Trust Score",exact:true}).count(),0);
  await page.getByRole("button",{name:"Map tools",exact:true}).click();
  await page.getByRole("button",{name:"Zoom to area",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-map-zoom="14.25"]'));
  await page.getByRole("button",{name:"Zoom to detail",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-map-zoom="19.25"]'));
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button",{name:"Map tools",exact:true}).getAttribute("aria-expanded"),"false");
  await page.getByRole("button",{name:"Fit captured trail",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-map-view="2d"][data-map-follow="false"]'));
  await page.getByRole("button",{name:"Map tools",exact:true}).click();
  await page.getByRole("button",{name:"Reset map view",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-map-view="3d"][data-map-follow="true"][data-map-zoom="17.25"]'));
  await page.getByRole("button",{name:"Zoom in",exact:true}).evaluate(button=>{button.click();button.click();button.click();});
  await page.waitForFunction(()=>document.querySelector('[data-map-zoom="18.00"]'));
  await page.getByRole("button",{name:"Zoom out",exact:true}).evaluate(button=>{button.click();button.click();button.click();});
  await page.waitForFunction(()=>document.querySelector('[data-map-zoom="17.25"]'));
  await page.getByRole("button",{name:"Follow device",exact:true}).click();
  const focus=page.getByRole("button",{name:"Focus map",exact:true});
  if(await focus.count()){
    await focus.click();await page.waitForFunction(()=>document.fullscreenElement!==null);
    await page.getByRole("button",{name:"Exit map focus",exact:true}).click();await page.waitForFunction(()=>document.fullscreenElement===null);
  }
  await page.keyboard.press("Escape");
  checks.push("Precision zoom presets, cumulative rapid zoom, fit-trail, camera reset, tools Escape, and supported fullscreen focus work");
  assert.equal(await page.getByRole("button",{name:/Position & evidence/}).count(),0);
  if(realTiles){await page.waitForFunction(()=>document.querySelector("[data-map-ready='true']")!==null);const deadline=Date.now()+30000;while((!style||tiles===0)&&Date.now()<deadline)await page.waitForTimeout(250);assert.ok(style&&tiles>0,"Actual OpenFreeMap style and vector tiles must load");await page.waitForTimeout(1500);}
  await capture(page,"map-3d-synthetic");
  for(const width of [360,390,768,1440])await fits(page,width);
  await fits(page,390);await capture(page,"map-mobile-synthetic");await fits(page,1440);
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.getByRole("button",{name:"Zoom in",exact:true}).click();
  assert.equal(await mapFrame.getAttribute("data-map-zoom"),"17.50","Reduced-motion camera controls must settle without a flight animation");
  await page.emulateMedia({reducedMotion:"no-preference"});
  checks.push("Live Map contains only tracking, with 2D/3D controls, follow, direction and four responsive widths");

  await page.goto(baseUrl+"/alerts",{waitUntil:"domcontentloaded"});
  await visible(page.getByRole("button",{name:/Motion data is unavailable/}));
  await page.getByRole("button",{name:"Integrity",exact:true}).click();
  assert.equal(await page.getByRole("button",{name:/Motion data is unavailable/}).count(),0);
  const rejected=page.getByRole("button",{name:/A damaged GPS message was rejected/});
  await rejected.click();
  await visible(page.getByText("A damaged NMEA sentence was rejected.",{exact:true}));
  await visible(page.getByText("No SOS event data supplied",{exact:true}));
  await capture(page,"alerts-synthetic");
  for(const width of [360,768,1440])await fits(page,width);
  historical=true;
  await visible(page.getByText("Historical observation · not a current alert",{exact:true}));
  checks.push("Alert filters and expandable evidence use supplied reason flags; disconnected observations are explicitly historical and SOS remains unavailable");
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto(baseUrl+"/help",{waitUntil:"domcontentloaded"});
  const help=page.getByRole("button",{name:"What is the Trust Score?",exact:true});
  await help.click();
  const revealId=await help.getAttribute("aria-controls");
  const transition=await page.locator(`[id="${revealId}"]`).evaluate(el=>getComputedStyle(el).transitionDuration);
  assert.ok(transition.split(",").every(value=>parseFloat(value)<=0.001),"Reduced motion must make disclosure transitions effectively instantaneous");
  await fits(page,390);await page.getByRole("button",{name:"Open navigation",exact:true}).click();
  await visible(page.getByRole("dialog",{name:"Workspace navigation",exact:true}));
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button",{name:"Open navigation",exact:true}).evaluate(el=>el===document.activeElement),true);
  checks.push("Reduced motion disables reveal animation and the mobile navigation modal restores keyboard focus");
  assert.deepEqual(errors,[],"Browser runtime exceptions");
  await context.close();
}
async function waitingAndRetry(browser) {
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  await context.addInitScript(require("./contact-fixture.cjs").seedContact);
  let privateRequests=0,credentialedRequests=0;
  await context.route("**/api/live",route=>{privateRequests++;if(route.request().headers().authorization)credentialedRequests++;return route.fulfill({status:401,contentType:"application/json",body:'{"error":"Private device link required"}'});});
  const page=await context.newPage();page.setDefaultTimeout(25000);
  const initialPoll=publicLive?page.waitForResponse(response=>new URL(response.url()).pathname==="/api/live"):null;
  await page.goto(baseUrl+"/map");
  if(initialPoll)await initialPoll;
  await visible(page.getByText("Waiting for your GPS",{exact:true}));
  assert.equal(await page.getByText("Device feed locked",{exact:true}).count(),0);
  assert.equal(privateRequests>0,publicLive,"Anonymous polling must follow the deployment's explicit public-live setting");
  assert.equal(credentialedRequests,0,"A fresh browser must never invent private device credentials");
  assert.equal(await page.getByRole("img",{name:"Current ESP32 GPS fix",exact:true}).count(),0);
  const running=await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==="running").length);
  assert.equal(running,0,"Reduced-motion waiting screen must not keep running decorative animations");
  await capture(page,"waiting-no-sensor");await fits(page,360);
  await context.close();
  const retry=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  await retry.addInitScript(require("./contact-fixture.cjs").seedContact);
  await retry.route("**/api/live",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(feed(Date.now()))}));
  let fail=true;
  await retry.route("https://tiles.openfreemap.org/styles/positron",route=>fail?route.fulfill({status:503,contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:'{}'}):route.fulfill({status:200,contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:JSON.stringify({version:8,sources:{},layers:[{id:"background",type:"background",paint:{"background-color":"#183c34"}}]})}));
  const p=await retry.newPage();p.setDefaultTimeout(25000);
  await p.goto(baseUrl+"/map#feed=synthetic_spatial_viewer_000000000000000");
  await visible(p.getByRole("button",{name:"Retry map",exact:true}));
  fail=false;await p.getByRole("button",{name:"Retry map",exact:true}).click();
  await visible(p.getByRole("img",{name:"Current ESP32 GPS fix",exact:true}));
  await retry.close();
  checks.push("Waiting screen honors public/private polling configuration, invents no credentials or position, respects reduced motion, and a failed map style recovers through Retry map");
}
async function usb(browser) {
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  await context.addInitScript(require("./contact-fixture.cjs").seedContact);
  await mapStub(context);
  await context.route("**/api/live",route=>route.fulfill({status:401,contentType:"application/json",body:'{"error":"Private link required"}'}));
  await context.addInitScript(()=>{
    const stats={requested:0,opened:0,closed:0,writes:0};let controller;
    const port={readable:null,async open(options){if(options.baudRate!==115200)throw Error("Wrong baud");stats.opened++;this.readable=new ReadableStream({start(c){controller=c;}});},async close(){stats.closed++;},async setSignals(){},writable:new WritableStream({write(){stats.writes++;}})};
    Object.defineProperty(navigator,"serial",{configurable:true,value:{async requestPort(){stats.requested++;return port;}}});
    window.__spatialUsb={stats,send(text){controller.enqueue(new TextEncoder().encode(text));}};
  });
  const page=await context.newPage();page.setDefaultTimeout(25000);
  await page.goto(baseUrl);
  await page.getByRole("button",{name:/Connection options/}).click();
  await page.getByRole("button",{name:"Connect ESP32",exact:true}).click();
  await visible(page.getByRole("button",{name:"Disconnect",exact:true}));
  await page.evaluate(text=>window.__spatialUsb.send(text),serialLines(Date.now()));
  await visible(page.getByRole("img",{name:"Current ESP32 GPS fix",exact:true}));
  await page.getByRole("link",{name:"Live map",exact:true}).first().click();
  await page.waitForURL(url=>url.pathname==="/map");
  // Hosted navigation can exceed the five-second freshness window. A real
  // connected device keeps streaming; send its next synthetic sample now.
  await page.evaluate(text=>window.__spatialUsb.send(text),serialLines(Date.now()));
  await visible(page.getByRole("img",{name:"Current ESP32 GPS fix",exact:true}));
  await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();
  await page.waitForURL(url=>url.pathname==="/");
  const options=page.getByRole("button",{name:/Connection options/});
  if(await options.getAttribute("aria-expanded")==="false")await options.click();
  await page.getByRole("button",{name:"Disconnect",exact:true}).click();
  await visible(page.getByRole("img",{name:"Last known ESP32 position, not current",exact:true}));
  await page.waitForFunction(()=>window.__spatialUsb.stats.closed===1);
  const stats=await page.evaluate(()=>window.__spatialUsb.stats);
  assert.deepEqual(stats,{requested:1,opened:1,closed:1,writes:0});
  await context.close();checks.push("Mock USB connects through disclosed controls, survives navigation, disconnects cleanly, and never writes serial data");
}

async function stabilization(browser) {
  const result = await require("./stationary-map-browser.cjs").verifyStationaryMap(browser, baseUrl);
  checks.push("Motion-aware GPS map: " + JSON.stringify(result));
}
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.SMARTTRACK_BROWSER_CHANNEL||"msedge",args:["--enable-webgl","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  try{await interactions(browser);await waitingAndRetry(browser);await usb(browser);await stabilization(browser);console.log(JSON.stringify({status:"passed",origin:baseUrl,mode:realTiles?"synthetic telemetry with actual OpenFreeMap tiles":"synthetic telemetry and map style fixtures",checks,screenshots},null,2));}
  finally{await browser.close();}
})().catch(error=>{console.error(JSON.stringify({status:"failed",checks,screenshots,error:error.stack},null,2));process.exitCode=1;});
