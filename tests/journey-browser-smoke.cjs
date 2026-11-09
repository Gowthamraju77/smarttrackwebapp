/* Synthetic GPS, roads and weather exercise the full UI without exposing a device location. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const { chromium } = require(process.env.SMARTTRACK_PLAYWRIGHT_PATH || path.join(os.tmpdir(), "smarttrack-browser-tools", "node_modules", "playwright"));
const origin = new URL(process.env.BASE_URL || "http://127.0.0.1:3104").origin;
const moduleData = { exports: {} };
new Function("exports", "module", ts.transpileModule(fs.readFileSync(path.join(__dirname, "../lib/live/telemetry.ts"), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText)(moduleData.exports, moduleData);
const { TelemetryDecoder } = moduleData.exports;
const start = { latitude: 52.52, longitude: 13.405 }, end = { latitude: 52.52, longitude: 13.415 };
const viewer = "synthetic_journey_viewer_000000000000000";
const visible = locator => locator.waitFor({ state: "visible" });
const checks = [], output = fs.mkdtempSync(path.join(os.tmpdir(), "smarttrack-journey-ui-"));
function nmea(body) { let sum = 0; for (const c of body) sum ^= c.charCodeAt(0); return `$${body}*${sum.toString(16).padStart(2,"0")}\n`; }
function snapshot(now, point) {
  const date = new Date(now), pad = v => String(v).padStart(2, "0");
  const time = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}.000`;
  const day = `${pad(date.getUTCDate())}${pad(date.getUTCMonth()+1)}${pad(date.getUTCFullYear()%100)}`;
  const live = new TelemetryDecoder().push(nmea(`GNRMC,${time},A,5231.2000,N,01324.3000,E,1.5,90,${day},,,A`) + 'MPU_SAMPLE {"ms":1000,"seq":1,"ax":0,"ay":0,"az":8192,"gx":0,"gy":0,"gz":0,"temp":1500}\n', now);
  live.gps.latitude = point.latitude; live.gps.longitude = point.longitude;
  return live;
}
function weather(lat, lon) { return { latitude:lat, longitude:lon, utc_offset_seconds:0,
  current_units:{time:"unixtime",interval:"seconds",temperature_2m:"°C",apparent_temperature:"°C",relative_humidity_2m:"%",weather_code:"wmo code",wind_speed_10m:"km/h",is_day:""},
  current:{time:Math.floor(Date.now()/1000),interval:900,temperature_2m:22.4,apparent_temperature:23,relative_humidity_2m:62,weather_code:2,wind_speed_10m:9.2,is_day:1} }; }
(async () => {
  const browser = await chromium.launch({headless:true,channel:process.env.SMARTTRACK_BROWSER_CHANNEL||"msedge",args:["--enable-webgl","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addInitScript(require("./contact-fixture.cjs").seedContact);
    await context.addInitScript(() => { window.__sectionMotions = 0; window.__sectionEntries = 0; const original = document.startViewTransition?.bind(document); if (original) document.startViewTransition = callback => { window.__sectionMotions++; return original(callback); }; const animate=Element.prototype.animate; Element.prototype.animate=function(...args){if(this.matches('[data-workspace-view]'))window.__sectionEntries++;return animate.apply(this,args);}; });
    await context.route("https://tiles.openfreemap.org/styles/positron", route => route.fulfill({contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:JSON.stringify({version:8,sources:{},layers:[{id:"background",type:"background",paint:{"background-color":"#173d36"}}]})}));
    let gps = null, connected = true, last = null, terrainFail = true, terrainPng = null, weatherFail = false;
    let routesRequested = 0, routeFail = false; const requestedPoints = [], weatherRequests = [], errors = [], sourceStart = Date.now()-1000;
    await context.route("**/api/live", route => {
      if (route.request().headers().authorization !== `Bearer ${viewer}`) return route.fulfill({status:401,contentType:"application/json",body:'{"error":"Private device link required"}'});
      const now = Date.now(), live = gps && connected ? snapshot(now,gps) : new TelemetryDecoder().snapshot(now);
      if (gps && connected) last = structuredClone(live);
      return route.fulfill({contentType:"application/json",body:JSON.stringify({version:1,source:"esp32-serial",generatedAt:now,startedAt:sourceStart,receivedAt:live.receivedAt,serial:{port:"SYNTHETIC",baudRate:115200,connected:!!gps&&connected,error:null},live,capturedSnapshot:last,trajectory:last?[{latitude:last.gps.latitude,longitude:last.gps.longitude,receivedAt:last.gps.receivedAt,recordedAt:last.gps.recordedAt}]:[]})});
    });
    await context.route("**/api/journey/places?*", route => {
      assert.equal(route.request().headers().authorization,undefined);
      const isStart = new URL(route.request().url()).searchParams.get("q").includes("Start");
      return route.fulfill({contentType:"application/json",body:JSON.stringify({places:[{...(isStart?start:end),id:isStart?"start":"end",label:isStart?"Synthetic Start Square":"Synthetic Finish Square"}],provider:"Synthetic places"})});
    });
    await context.route("**/api/journey/routes", route => {
      routesRequested++; assert.equal(route.request().headers().authorization,undefined);
      const body=route.request().postDataJSON(); assert.ok(body.start&&body.end);
      requestedPoints.push(body);
      if (routeFail) return route.fulfill({status:503,contentType:"application/json",body:'{"error":"Road routing is unavailable right now. Please try again."}'});
      return route.fulfill({contentType:"application/json",body:JSON.stringify({routes:[
        {coordinates:[[13.405,52.52],[13.415,52.52]],distanceM:700,durationS:180,provider:"Synthetic road fixture",startSnapDistanceM:0,endSnapDistanceM:0},
        {coordinates:[[13.405,52.52],[13.410,52.522],[13.415,52.52]],distanceM:1300,durationS:300,provider:"Synthetic road fixture",startSnapDistanceM:0,endSnapDistanceM:0}
      ],profile:"driving",traffic:false})});
    });
    await context.route("https://api.open-meteo.com/**", route => {
      const url=new URL(route.request().url()),lat=Number(url.searchParams.get("latitude")),lon=Number(url.searchParams.get("longitude"));weatherRequests.push({lat,lon});
      return route.fulfill({status:weatherFail?503:200,contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:JSON.stringify(weather(lat,lon))});
    });
    await context.route("https://s3.amazonaws.com/**", route => terrainFail ? route.abort() : route.fulfill({contentType:"image/png",headers:{"access-control-allow-origin":"*"},body:terrainPng}));
    const page=await context.newPage();page.setDefaultTimeout(30000);page.on("pageerror",e=>errors.push(e.message));
    await page.goto(`${origin}/map`);
    assert.equal(await page.getByRole("region",{name:"Journey planner",exact:true}).count(),0);
    assert.equal(await page.getByRole("region",{name:"Nearby climate",exact:true}).count(),0);
    assert.equal(await page.getByRole("region",{name:"Trust Score",exact:true}).count(),0);
    await page.getByRole("link",{name:"Navigation",exact:true}).first().click();
    await visible(page.getByRole("heading",{name:"Choose a route first",exact:true}));
    assert.equal(await page.getByRole("searchbox",{name:"Search start place",exact:true}).count(),0);
    await page.goBack();await page.waitForURL(url=>url.pathname==="/map");
    assert.ok(await page.evaluate(()=>window.__sectionEntries>=1),"Browser Back must animate the restored section");
    await page.getByRole("link",{name:"Journey",exact:true}).first().click();await page.waitForURL(url=>url.pathname==="/journeys");
    const planner=page.getByRole("region",{name:"Journey planner",exact:true});
    await visible(planner);assert.equal(weatherRequests.length,0);
    await planner.getByRole("button",{name:"Choose start on map",exact:true}).click();
    await visible(page.getByRole("button",{name:"Use map center",exact:true}));
    await page.waitForFunction(()=>document.querySelector('[data-map-ready="true"][data-map-context="planning"]'));
    assert.ok(await page.locator('.maplibregl-map').evaluate(el=>el.clientHeight>300&&Math.abs(el.clientHeight-el.parentElement.clientHeight)<=1),"Map container must have real visible height");
    assert.equal(await page.getByRole("img",{name:/ESP32/}).count(),0);
    await page.getByRole("button",{name:"Use map center",exact:true}).click();
    await visible(page.getByRole("img",{name:"Planned start",exact:true}));
    await planner.getByRole("button",{name:"Choose destination on map",exact:true}).click();await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("button",{name:"Use map center",exact:true}).count(),0);
    await planner.getByRole("button",{name:"Choose destination on map",exact:true}).click();
    await page.locator('.maplibregl-canvas').click({position:{x:170,y:260}});
    await visible(page.getByRole("img",{name:"Planned destination",exact:true}));
    await visible(planner.getByRole("radio",{name:"Choose route 2",exact:true}));
    await planner.getByRole("button",{name:"Reset journey",exact:true}).click();
    routesRequested=0;requestedPoints.length=0;routeFail=true;
    checks.push("Map picking works before any GPS, keyboard selection and Escape work, and no device position is invented");
    await planner.getByRole("searchbox",{name:"Search start place",exact:true}).fill("Synthetic Start");
    await planner.getByRole("button",{name:"Synthetic Start Square",exact:true}).click();
    await planner.getByRole("searchbox",{name:"Search destination place",exact:true}).fill("Synthetic Finish");
    await planner.getByRole("button",{name:"Synthetic Finish Square",exact:true}).click();
    await visible(planner.getByRole("button",{name:"Retry routes",exact:true}));
    assert.match(await planner.innerText(),/Synthetic Start Square/);assert.match(await planner.innerText(),/Synthetic Finish Square/);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem("smarttrack.feed.viewer.v1")),null);
    routeFail=false;await planner.getByRole("button",{name:"Retry routes",exact:true}).click();
    await visible(planner.getByRole("radio",{name:"Choose route 2",exact:true}));
    assert.deepEqual(requestedPoints[1],requestedPoints[0],"Retry must preserve both selected places");
    assert.equal(await planner.getByRole("button",{name:"Start journey",exact:true}).isDisabled(),true);
    assert.match(await planner.innerText(),/0\.70 km/);assert.match(await planner.innerText(),/1\.30 km/);assert.match(await planner.innerText(),/5 min estimated/);
    await planner.getByRole("radio",{name:"Choose route 2",exact:true}).check();assert.equal(await planner.getByRole("radio",{name:"Choose route 2",exact:true}).isChecked(),true);
    await planner.getByRole("radio",{name:"Choose route 1",exact:true}).check();assert.equal(routesRequested,2);
    assert.equal(await planner.getByRole("timer").count(),0);
    await planner.getByRole("button",{name:"Start journey",exact:true}).click();await page.waitForURL(url=>url.pathname==="/navigation");
    const navigation=page.getByRole("region",{name:"Journey navigation",exact:true});
    await visible(navigation.getByText("Waiting for fresh GPS",{exact:true}));
    assert.equal(await navigation.getByRole("timer").innerText(),"Waiting");
    assert.equal(await planner.count(),0);
    assert.ok(await page.evaluate(()=>window.__sectionMotions>=3),"Client section links and Start journey must invoke the transition API");
    checks.push("Planning works without a private device link; provider failure retries the same points, routes show km/ETA, and arming waits for GPS");
    await page.goto(`${origin}/navigation#feed=${viewer}`);
    gps=start;await visible(page.getByRole("button",{name:"Finish journey",exact:true}));
    await page.waitForFunction(()=>document.querySelector('[data-heading="90"]'));
    await page.waitForFunction(()=>/^00:00:0[2-9]$/.test(document.querySelector('[aria-label="Journey elapsed time"]')?.textContent||""));
    await page.reload();await visible(page.getByRole("button",{name:"Finish journey",exact:true}));
    assert.match(await navigation.innerText(),/Synthetic Start Square/);assert.equal(routesRequested,2);
    await page.getByRole("link",{name:"Live map",exact:true}).first().click();await page.waitForURL(url=>url.pathname==="/map");
    await visible(page.getByRole("img",{name:/Current ESP32 GPS fix/}));
    assert.equal(await page.getByRole("img",{name:"Planned start",exact:true}).count(),0);
    assert.equal(await page.getByRole("timer").count(),0);
    await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();await page.waitForURL(url=>url.pathname==="/");
    const climate=page.getByRole("region",{name:"Nearby climate",exact:true});await visible(climate.getByText("Current GPS area",{exact:true}));
    assert.deepEqual(weatherRequests[0],{lat:start.latitude,lon:start.longitude});assert.match(await climate.innerText(),/22\.4/);
    checks.push("Fresh GPS starts timing; selected plan and active timer survive reload without requesting routes again");
    gps={latitude:52.531,longitude:13.409};weatherFail=true;
    await visible(page.getByRole("alert",{name:"Journey notification",exact:true}));
    await visible(climate.getByText("Previous GPS area",{exact:true}));assert.ok(weatherRequests.some(p=>p.lat===gps.latitude));
    await page.getByRole("button",{name:"Dismiss journey notification",exact:true}).click();
    connected=false;await visible(climate.getByText("Historical estimate",{exact:true}));
    await page.getByRole("link",{name:"Navigation",exact:true}).first().click();await page.waitForURL(url=>url.pathname==="/navigation");
    await visible(navigation.getByText("Waiting for fresh GPS",{exact:true}));
    const prior=await navigation.getByRole("timer").innerText();
    await page.waitForFunction(value=>document.querySelector('[aria-label="Journey elapsed time"]')?.textContent!==value,prior);
    assert.equal(await page.getByRole("alert",{name:"Journey notification",exact:true}).count(),0);
    checks.push("Sustained raw GPS deviation raises an in-page alert; moving GPS refreshes climate; failed weather stays historical and GPS loss keeps timing without new alerts");
    gps=end;connected=true;weatherFail=false;
    await visible(navigation.getByText("Journey complete",{exact:true}));await visible(page.getByRole("status",{name:"Journey notification",exact:true}));
    const finalTime=await navigation.getByRole("timer").innerText();await page.reload();await visible(navigation.getByText("Journey complete",{exact:true}));
    assert.equal(await navigation.getByRole("timer").innerText(),finalTime);assert.equal(await page.getByRole("status",{name:"Journey notification",exact:true}).count(),0);
    checks.push("Two destination GPS observations finish the journey and freeze elapsed time; reload does not replay arrival notifications");
    await page.getByRole("button",{name:"Map tools",exact:true}).click();await page.getByRole("button",{name:"Terrain elevation",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-map-terrain="unavailable"][data-map-ready="true"]'));
    terrainPng=Buffer.from(await page.evaluate(()=>{const c=document.createElement("canvas");c.width=c.height=256;const g=c.getContext("2d");g.fillStyle="rgb(128,0,0)";g.fillRect(0,0,256,256);return c.toDataURL("image/png").split(",")[1];}),"base64");terrainFail=false;
    await page.getByRole("button",{name:"Terrain elevation",exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-map-terrain="ready"]'));
    await page.getByRole("button",{name:"Rotate right",exact:true}).click();await page.getByRole("button",{name:"Tilt less",exact:true}).click();
    await page.keyboard.press("Escape");
    checks.push("Optional terrain failure preserves the street map; retry loads DEM tiles and rotation/tilt remain usable");
    await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});});
    await page.screenshot({path:path.join(output,"journey-desktop-synthetic.png"),fullPage:true});
    for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow at ${width}`);}
    await page.setViewportSize({width:390,height:844});await navigation.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,"navigation-mobile.png")});
    await page.getByRole("link",{name:"View journey plan",exact:true}).click();await page.waitForURL(url=>url.pathname==="/journeys");
    await planner.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,"journey-mobile-planner.png")});
    assert.equal(await planner.getByRole("radio",{name:"Choose route 1",exact:true}).isChecked(),true);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(output,"journey-mobile-synthetic.png"),fullPage:true});
    assert.deepEqual(errors,[]);checks.push("Journey/climate layouts fit mobile, tablet and desktop without JavaScript errors");
    console.log(JSON.stringify({status:"passed",origin,checks,screenshots:output},null,2));await context.close();
  } finally {await browser.close();}
})().catch(error=>{console.error(JSON.stringify({status:"failed",checks,error:error.stack,screenshots:output},null,2));process.exitCode=1;});
