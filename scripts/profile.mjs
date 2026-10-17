import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { arch, cpus, platform, release, totalmem } from 'node:os';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (!process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({executablePath, headless: true});
try {
const page = await browser.newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(process.env.PROFILE_URL ?? 'http://127.0.0.1:4173/aoe1/');
await page.getByTestId('quick-start').click();
const metadata = await page.evaluate(() => {
  let gpu = 'Unavailable';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  } catch {}
  return {userAgent: navigator.userAgent, width: innerWidth, height: innerHeight, dpr: devicePixelRatio, gpu, hardwareConcurrency: navigator.hardwareConcurrency};
});
metadata.browser = browser.version();
metadata.host = {
  cpuModel: cpus()[0]?.model ?? 'Unknown', logicalCpus: cpus().length,
  platform: platform(), release: release(), architecture: arch(), hostMemoryBytes: totalmem(),
  cgroupCpuMax: (await readFile('/sys/fs/cgroup/cpu.max','utf8').catch(()=>'unavailable')).trim(),
  cgroupMemoryMax: (await readFile('/sys/fs/cgroup/memory.max','utf8').catch(()=>'unavailable')).trim(),
};
const results = [];
for (const total of [200, 400]) {
  const prepared = await page.evaluate(total => {
    let d = window.__DAWN__;
    const settings = {...d.engine.state.settings, seed: `PROFILE-${total}`, size: 'medium', opponents: total === 200 ? 1 : 3, population: 150, speed: 1, peaceful: false, tutorial: false, difficulty: 'normal'};
    d.app.start(settings);
    d = window.__DAWN__;
    d.renderer.quality = 'medium';
    d.renderer.resize();
    const e = d.engine, s = e.state, center = s.map.size / 2;
    // Developed-settlement fixtures only: ordinary rules and local AI remain
    // live throughout samples. These constructors do not test economy buildup.
    const housing = [];
    for (const p of s.players) {
      p.age = 4;
      const home = s.map.starts[p.id];
      let built = 0;
      for (let ring = 5; ring < 27 && built < 18; ring++) {
        for (let y = -ring; y <= ring && built < 18; y += 3) for (let x = -ring; x <= ring && built < 18; x += 3) {
          const ox = Math.floor(home.x + x), oy = Math.floor(home.y + y);
          if (!e.canPlace(p.id, 'house', ox, oy).ok) continue;
          e.createBuilding(p.id, 'house', ox + 1, oy + 1);
          e.step(1);
          built++;
        }
      }
      housing.push(built);
    }
    const sides = [[-8,0],[8,0],[0,-8],[0,8]];
    for (const p of s.players) {
      const owned = s.entities.filter(x => x.owner === p.id && x.kind === 'unit').length;
      const count = total / s.players.length - owned;
      for (let i = 0; i < count; i++) {
        const types = ['heavy','heavy','infantry','archer','cavalry'];
        const [dx,dy] = sides[p.id];
        const x = center + dx + (i%10-4.5)*.7;
        const y = center + dy + (Math.floor(i/10)-4.5)*.7;
        const unit = e.createUnit(p.id, types[i%types.length], x, y);
        if (!e.canStand(unit,x,y)) {
          let found = false;
          for (let r = 1; r < 5 && !found; r++) for (let oy = -r; oy <= r && !found; oy++) for (let ox = -r; ox <= r && !found; ox++) {
            const nx = Math.floor(x+ox)+.5, ny = Math.floor(y+oy)+.5;
            if (e.canStand(unit,nx,ny)) { unit.x = unit.prevX = nx; unit.y = unit.prevY = ny; found = true; }
          }
          if (!found) throw new Error(`No valid profiling spawn for owner ${p.id}, unit ${i}`);
        }
      }
    }
    e.step(1);
    let accepted = 0;
    for (const p of s.players) {
      const ids = s.entities.filter(x => x.owner === p.id && x.kind === 'unit' && x.type !== 'villager').map(x => x.id);
      if (e.command(p.id,{type:'order',ids,order:{type:'attackMove',x:center,y:center}}).ok) accepted++;
    }
    d.renderer.center(center,center); d.renderer.zoom = .8;
    return {target: total, units: s.entities.filter(x=>x.kind==='unit').length, tick: s.tick, housing, accepted, settings, graphics:d.renderer.graphics};
  }, total);
  if (prepared.units !== total || prepared.accepted !== prepared.settings.opponents+1) throw new Error(`Invalid ${total}-unit fixture: ${JSON.stringify(prepared)}`);
  await page.waitForTimeout(1500);
  const sample = await page.evaluate(() => new Promise(resolve => {
    const intervals = [], sim = [], ai = [], unitCounts = [];
    const start = performance.now(); let last = start;
    const memoryStart = performance.memory?.usedJSHeapSize ?? null;
    const d = window.__DAWN__; d.app.resetPerformance();
    function frame(now) {
      intervals.push(now-last); last=now;
      sim.push(d.engine.metrics.simulationMs); ai.push(d.engine.metrics.aiMs);
      unitCounts.push(d.engine.state.entities.filter(e=>e.kind==='unit').length);
      if (now-start < 20000) requestAnimationFrame(frame);
      else {
        const pct = (v,p) => [...v].sort((a,b)=>a-b)[Math.min(v.length-1,Math.floor(v.length*p))] ?? 0;
        resolve({durationMs:now-start,frames:intervals.length,averageFPS:intervals.length*1000/(now-start),p50:pct(intervals,.5),p95:pct(intervals,.95),p99:pct(intervals,.99),worst:Math.max(...intervals),simulationP95:pct(sim,.95),aiP95:pct(ai,.95),unitsStart:unitCounts[0],unitsEnd:unitCounts.at(-1),memoryStart,memoryEnd:performance.memory?.usedJSHeapSize??null,graphics:d.renderer.graphics,app:d.app.performance()});
      }
    }
    requestAnimationFrame(frame);
  }));
  results.push({prepared,sample}); console.log(JSON.stringify({scenario:total,...sample}));
}

// Actual pointerdown -> the target indicator reaching Canvas rendering.
await page.getByTestId('pause').click();
await page.getByTestId('restart').click();
const pointer = await page.evaluate(() => {
  const d=window.__DAWN__,s=d.engine.state;
  const worker=s.entities.find(e=>e.owner===0&&e.type==='villager');
  d.renderer.center(worker.x,worker.y);
  const from=d.renderer.worldToScreen(worker.x,worker.y),to=d.renderer.worldToScreen(worker.x-2,worker.y+2);
  window.__ack={}; window.__acks=[];
  document.querySelector('#world').addEventListener('pointerdown',event=>{if(event.button===2)window.__ack={start:performance.now()};},{capture:true});
  const original=d.renderer.render;
  d.renderer.render=function(...args){const value=original.apply(this,args);if(window.__ack.start&&this.target?.time>=window.__ack.start&&!window.__ack.renderMs){window.__ack.renderMs=performance.now()-window.__ack.start;window.__acks.push(window.__ack.renderMs);}return value;};
  return {from,to};
});
await page.mouse.click(pointer.from.x,pointer.from.y-6);
for(let i=0;i<10;i++) {
  await page.mouse.click(pointer.to.x+(i%2?20:0),pointer.to.y,{button:'right'});
  await page.waitForFunction(count=>window.__acks.length>=count,i+1);
}
const acknowledgment=await page.evaluate(()=>{
  const samples=[...window.__acks],sorted=[...samples].sort((a,b)=>a-b);
  return {samples,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],worst:Math.max(...samples)};
});

const cdp=await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.collectGarbage');
const memoryBefore=(await cdp.send('Runtime.getHeapUsage')).usedSize;
for(let i=0;i<10;i++){
  await page.evaluate(i=>{const d=window.__DAWN__;d.app.start({...d.engine.state.settings,seed:`RESTART-${i}`});},i);
  await page.waitForTimeout(220);
}
await cdp.send('HeapProfiler.collectGarbage');
const memoryAfter=(await cdp.send('Runtime.getHeapUsage')).usedSize;
const before=await page.evaluate(()=>window.__DAWN__.engine.state.tick);
await page.waitForTimeout(1000);
const after=await page.evaluate(()=>window.__DAWN__.engine.state.tick);
const restart={count:10,gcHeapBefore:memoryBefore,gcHeapAfter:memoryAfter,oneSecondTickDelta:after-before};
const buildFiles=[];
async function measureBuild(directory,relative='',files=buildFiles) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const url=new URL(entry.name+(entry.isDirectory()?'/':''),directory),name=relative+entry.name;
    if(entry.isDirectory())await measureBuild(url,`${name}/`,files);
    else {const bytes=await readFile(url);files.push({name,bytes:bytes.length,gzipBytes:gzipSync(bytes).length});}
  }
}
await measureBuild(new URL('../dist/',import.meta.url));
const build={files:buildFiles,bytes:buildFiles.reduce((n,f)=>n+f.bytes,0),gzipBytes:buildFiles.reduce((n,f)=>n+f.gzipBytes,0)};
const artifactFiles=[]; await measureBuild(new URL('../dist-pages/',import.meta.url),'',artifactFiles);
const artifact={files:artifactFiles.length,bytes:artifactFiles.reduce((n,f)=>n+f.bytes,0),gzipBytes:artifactFiles.reduce((n,f)=>n+f.gzipBytes,0)};
const report={metadata,results,acknowledgment,restart,build,artifact,errors};
const output=new URL('../.local/browser-profile.json',import.meta.url);
await mkdir(new URL('../.local/',import.meta.url),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({metadata,acknowledgment,restart,build,artifact,errors}));
console.log(`Full report: ${fileURLToPath(output)}`);
if(errors.length)throw new Error(`Uncaught browser errors: ${errors.join('; ')}`);
} finally { await browser.close(); }
