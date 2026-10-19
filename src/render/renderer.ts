import type { Engine } from '../game/engine';
import type { BuildingType, Entity, GameState, Point, Terrain, UnitType } from '../game/types';
import { BUILDINGS, UNITS } from '../game/data';
const TW=64,TH=32;
const SIZES=Object.fromEntries(Object.entries(BUILDINGS).map(([key,value])=>[key,value.size])) as Record<BuildingType,number>;
const artScale=(type:BuildingType)=>.8+SIZES[type]*.28;
const TEAM='#66b8bb';
const hash=(x:number,y:number,n=0)=>{const v=Math.sin(x*127.1+y*311.7+n*74.7)*43758.5453;return v-Math.floor(v);};
const poly=(c:CanvasRenderingContext2D,p:number[][],fill:string,stroke?:string)=>{c.beginPath();p.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.stroke();}};
const ellipse=(c:CanvasRenderingContext2D,x:number,y:number,rx:number,ry:number,color:string)=>{c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=color;c.fill();};
const line=(c:CanvasRenderingContext2D,x1:number,y1:number,x2:number,y2:number,color:string,width=1)=>{c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();};
const mix=(hex:string,f:number)=>{const n=parseInt(hex.slice(1),16);return `rgb(${Math.round((n>>16)*f)},${Math.round(((n>>8)&255)*f)},${Math.round((n&255)*f)})`;};
const terrainNoise=(x:number,y:number)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);return(hash(ix,iy)*(1-u)+hash(ix+1,iy)*u)*(1-v)+(hash(ix,iy+1)*(1-u)+hash(ix+1,iy+1)*u)*v;};
interface Sprite{canvas:HTMLCanvasElement;ox:number;oy:number;}
interface UnitPose extends Sprite{sx:number;sy:number;slot:number;}
/** Isometric renderer. Public screen coordinates are browser client pixels. */
export class Renderer{
 engine?:Engine;selection:number[]=[];hover?:number;
 placement?:{type:BuildingType;x:number;y:number;valid:boolean};
 drag?:{x1:number;y1:number;x2:number;y2:number};target?:{x:number;y:number;time:number};
 quality:'low'|'medium'|'high'|'auto'='auto';width=0;height=0;zoom=1;
 private ctx:CanvasRenderingContext2D;private camera:Point={x:18,y:18};private dpr=1;
 private autoDetail:0|1|2=1;private renderAverage=0;private renderSamples=0;private fastWindows=0;private qualityWindow=0;private pendingResize=false;private previousQuality:Renderer['quality']='auto';
 private get detail():0|1|2{return this.quality==='auto'?this.autoDetail:this.quality==='low'?0:this.quality==='medium'?1:2;}
 get graphics(){return{effectiveQuality:['low','medium','high'][this.detail],pixelRatio:this.dpr,averageRenderMs:this.renderAverage,unitCache:{entries:this.unitSprites.size,pages:this.unitPages.length,hits:this.unitCacheHits,misses:this.unitCacheMisses,evictions:this.unitCacheEvictions}};}
 private adjustQuality(cost:number,now:number){this.renderAverage=this.renderSamples?this.renderAverage*.95+cost*.05:cost;this.renderSamples++;if(this.quality!=='auto'||this.renderSamples<30||now-this.qualityWindow<1500)return;this.qualityWindow=now;this.renderSamples=0;let next=this.autoDetail;if(this.renderAverage>12){next=Math.max(0,next-1) as 0|1|2;this.fastWindows=0;}else if(this.renderAverage<5){if(++this.fastWindows>=3){next=Math.min(2,next+1) as 0|1|2;this.fastWindows=0;}}else this.fastWindows=0;if(next!==this.autoDetail){this.autoDetail=next;this.tiles.clear();this.sprites.clear();this.clearUnitSprites();this.terrainStamp='';this.pendingResize=true;}}
 private tiles=new Map<string,HTMLCanvasElement>();private sprites=new Map<string,Sprite>();
 private unitSprites=new Map<string,UnitPose>();
 private unitPages:HTMLCanvasElement[]=[];
 private nextUnitSlot=0;
 private unitCacheHits=0;private unitCacheMisses=0;private unitCacheEvictions=0;
 private clearUnitSprites(){this.unitSprites.clear();this.nextUnitSlot=0;this.unitCacheHits=0;this.unitCacheMisses=0;this.unitCacheEvictions=0;}
 private minimapPixels?:ImageData;private terrainLayer?:HTMLCanvasElement;private terrainStamp='';
 private fogVisible:number[]=[];private fogExplored:number[]=[];private fogTick=-100;private mapKey='';private lastCamera='';
 private buildingAges=new Map<number,number>();
 private settlementPaths:{a:Point;b:Point}[]=[];
 private isFriendly(owner:number){return owner>=0&&(owner===0||!!(this.engine as Engine&{areAllied?:(a:number,b:number)=>boolean})?.areAllied?.(0,owner));}
 private mini?:HTMLCanvasElement;private miniTick=-100;private miniKey='';private disposed=false;
 constructor(public canvas:HTMLCanvasElement){const c=canvas.getContext('2d',{alpha:false});if(!c)throw new Error('Canvas 2D is unavailable');this.ctx=c;this.resize();}
 setEngine(engine:Engine){this.engine=engine;this.fogTick=-100;this.miniTick=-100;this.mapKey='';this.terrainStamp='';this.clearUnitSprites();this.buildingAges.clear();}
 resize(){const r=this.canvas.getBoundingClientRect();this.width=r.width||window.innerWidth;this.height=r.height||window.innerHeight;this.dpr=Math.min(window.devicePixelRatio||1,this.detail===0?1:this.detail===1?1.5:2);const w=Math.round(this.width*this.dpr),h=Math.round(this.height*this.dpr);if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);}
 center(x:number,y:number){this.camera={x,y};}
 pan(dx:number,dy:number){this.camera.x-=(dx/TW+dy/TH)/this.zoom;this.camera.y-=(dy/TH-dx/TW)/this.zoom;this.clampCamera();}
 zoomAt(factor:number,clientX:number,clientY:number){const before=this.screenToWorld(clientX,clientY);this.zoom=Math.max(.42,Math.min(1.9,this.zoom*factor));const after=this.screenToWorld(clientX,clientY);this.camera.x+=before.x-after.x;this.camera.y+=before.y-after.y;this.clampCamera();}
 private clampCamera(){const n=this.engine?.state.map.size;if(n){this.camera.x=Math.max(-5,Math.min(n+5,this.camera.x));this.camera.y=Math.max(-5,Math.min(n+5,this.camera.y));}}
 private project(x:number,y:number):Point{return{x:this.width*.5+((x-y)-(this.camera.x-this.camera.y))*TW*.5*this.zoom,y:this.height*.43+((x+y)-(this.camera.x+this.camera.y))*TH*.5*this.zoom};}
 worldToScreen(x:number,y:number):Point{const r=this.canvas.getBoundingClientRect(),p=this.project(x,y);return{x:p.x+r.left,y:p.y+r.top};}
 screenToWorld(clientX:number,clientY:number):Point{const r=this.canvas.getBoundingClientRect(),sx=(clientX-r.left-this.width*.5)/this.zoom,sy=(clientY-r.top-this.height*.43)/this.zoom;return{x:this.camera.x+sx/TW+sy/TH,y:this.camera.y+sy/TH-sx/TW};}
 private localWorld(x:number,y:number):Point{const sx=(x-this.width*.5)/this.zoom,sy=(y-this.height*.43)/this.zoom;return{x:this.camera.x+sx/TW+sy/TH,y:this.camera.y+sy/TH-sx/TW};}
 render(alpha=1){
  if(this.disposed)return;const renderStart=performance.now();if(this.pendingResize){this.pendingResize=false;this.resize();}
  if(this.previousQuality!==this.quality){this.previousQuality=this.quality;this.autoDetail=1;this.renderSamples=0;this.renderAverage=0;this.fastWindows=0;this.qualityWindow=renderStart;this.tiles.clear();this.sprites.clear();this.clearUnitSprites();this.terrainStamp='';this.resize();}
  const c=this.ctx;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.globalAlpha=1;c.fillStyle='#15221e';c.fillRect(0,0,this.width,this.height);
  const engine=this.engine;if(!engine)return;const s=engine.state,map=s.map,n=map.size,player=s.players[0];
  const camKey=`${Math.floor(this.camera.x*2)},${Math.floor(this.camera.y*2)},${this.zoom}`,mapKey=`${map.generation}/${map.seed}/${n}`;
  if(this.mapKey!==mapKey){this.mapKey=mapKey;this.tiles.clear();this.fogTick=-100;this.miniTick=-100;}
  if(Math.floor(s.tick/8)!==Math.floor(this.fogTick/8)||this.fogTick>s.tick||camKey!==this.lastCamera){this.fogVisible=player?.visible.slice()||[];this.fogExplored=player?.explored.slice()||[];this.fogTick=s.tick-s.tick%8;this.lastCamera=camKey;}
  const corners=[this.localWorld(-130,-140),this.localWorld(this.width+130,-140),this.localWorld(-130,this.height+140),this.localWorld(this.width+130,this.height+140)];
  const x0=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.x)))-1),x1=Math.min(n-1,Math.ceil(Math.max(...corners.map(p=>p.x)))+1),y0=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.y)))-1),y1=Math.min(n-1,Math.ceil(Math.max(...corners.map(p=>p.y)))+1);
  const terrainStamp=`${mapKey}/${this.camera.x.toFixed(4)}/${this.camera.y.toFixed(4)}/${this.zoom}/${this.width}/${this.height}/${this.dpr}/${this.fogTick}`;
  if(terrainStamp!==this.terrainStamp){const wear=this.settlementWear(s);if(!this.terrainLayer)this.terrainLayer=document.createElement('canvas');const layer=this.terrainLayer;if(layer.width!==this.canvas.width||layer.height!==this.canvas.height){layer.width=this.canvas.width;layer.height=this.canvas.height;}const gc=layer.getContext('2d',{alpha:false})!;gc.setTransform(this.dpr,0,0,this.dpr,0,0);gc.globalAlpha=1;gc.fillStyle='#15221e';gc.fillRect(0,0,this.width,this.height);gc.save();gc.translate(this.width*.5,this.height*.43);gc.scale(this.zoom,this.zoom);gc.translate(-(this.camera.x-this.camera.y)*32,-(this.camera.x+this.camera.y)*16);
   for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const i=y*n+x,seen=this.fogExplored[i],visible=this.fogVisible[i],px=(x-y)*32,py=(x+y+1)*16;if(!seen&&!visible)continue;const terrain=map.tiles[i],variant=Math.min(11,Math.floor(terrainNoise(x*.15,y*.15)*12)),dim=visible?0:1,road=wear.get(i)||0,deco=this.detail===0?0:road?0:hash(x,y,17)>.996?3:hash(x,y,18)>.975?2:hash(x,y,19)>.966?1:0;gc.drawImage(this.terrainTile(terrain,variant,dim,road,deco),px-33,py-18);if(visible&&terrain===2&&this.detail>0&&hash(x,y,7)>.76){gc.globalAlpha=Math.sin(s.tick*.025+x+y)*.13+.15;line(gc,px-9,py,px+8,py-2,'#c9dfcd',1);gc.globalAlpha=1;}}
   this.drawSettlementTrails(gc,s);gc.restore();this.terrainStamp=terrainStamp;}
  c.drawImage(this.terrainLayer!,0,0,this.width,this.height);c.save();c.translate(this.width*.5,this.height*.43);c.scale(this.zoom,this.zoom);c.translate(-(this.camera.x-this.camera.y)*32,-(this.camera.x+this.camera.y)*16);
  // Hidden static entities use last-seen snapshots, never their hidden live state.
  const draw:{entity:Entity;memory:boolean;depth:number}[]=[],shown=new Set<number>();
  for(const e of s.entities){const visible=e.owner===0||!!player?.visible[Math.floor(e.y)*n+Math.floor(e.x)];if(!visible||e.x<x0-5||e.x>x1+5||e.y<y0-5||e.y>y1+5)continue;draw.push({entity:e,memory:false,depth:e.x+e.y});shown.add(e.id);}
  for(const e of Object.values(player?.memory||{})){if(e.kind==='unit'||shown.has(e.id)||player?.visible[Math.floor(e.y)*n+Math.floor(e.x)]||e.x<x0-5||e.x>x1+5||e.y<y0-5||e.y>y1+5)continue;draw.push({entity:e,memory:true,depth:e.x+e.y});}
  draw.sort((a,b)=>a.depth-b.depth||(a.entity.kind==='building'?-1:1));
  // Finish all atlas writes before the first page read. Interleaved writes/reads
  // force canvas texture snapshots and costly fences on software GPU backends.
  for(const item of draw)if(item.entity.kind==='unit')this.unitSprite(item.entity,s.players[item.entity.owner]?.color||TEAM,s.tick,alpha);
  const selected=new Set(this.selection);if(this.placement)this.drawPlacement(c);
  for(const item of draw){const e=item.entity,x=e.kind==='unit'?e.prevX+(e.x-e.prevX)*alpha:e.x,y=e.kind==='unit'?e.prevY+(e.y-e.prevY)*alpha:e.y,px=(x-y)*32,py=(x+y)*16;if(px<((this.camera.x-this.camera.y)*32-this.width/this.zoom*.5)-160||px>((this.camera.x-this.camera.y)*32+this.width/this.zoom*.5)+160)continue;c.save();c.translate(px,py);if(item.memory)c.globalAlpha=.48;const isSelected=selected.has(e.id),isHover=this.hover===e.id;if(isSelected||isHover)this.selectionRing(c,e,isSelected);const color=s.players[e.owner]?.color||TEAM;if(e.kind==='unit')this.drawUnit(c,e,color,s.tick,alpha);else{const sp=this.entitySprite(e,color);c.drawImage(sp.canvas,-sp.ox,-sp.oy);if(e.kind==='building'&&!e.completed)this.construction(c,e);}if(!item.memory&&(isSelected||isHover||e.hp<e.maxHp&&e.kind!=='resource'))this.health(c,e);if(isSelected&&!item.memory&&e.kind==='building'&&e.rally){const r=e.rally;this.rallyFlag(c,((r.x-r.y)-(x-y))*32,((r.x+r.y)-(x+y))*16,color);}c.restore();}
  // Non-graphic dust and earth-colored fragments provide brief loss feedback.
  for(let i=s.events.length-1;i>=0;i--){const event=s.events[i],elapsed=s.tick-event.tick-1+alpha;if(s.tick-event.tick>12)break;if(event.type!=='death'||event.x===undefined||event.y===undefined||elapsed<0)continue;if(event.owner!==0&&!player?.visible[Math.floor(event.y)*n+Math.floor(event.x)])continue;if(event.x<x0||event.x>x1||event.y<y0||event.y>y1)continue;const t=elapsed/12;if(t>=1)continue;const px=(event.x-event.y)*32,py=(event.x+event.y)*16,scale=event.text.startsWith('Building')?2:1,count=this.detail===0?3:this.detail===1?6:9;c.save();c.globalAlpha=(1-t)*.55;for(let k=0;k<count;k++){const angle=hash(event.tick,k,event.entity||0)*Math.PI*2,r=(3+t*19)*scale*(.5+hash(k,event.tick));ellipse(c,px+Math.cos(angle)*r,py+Math.sin(angle)*r*.4-t*13*scale,(2+t*5)*scale,(1.6+t*3)*scale,k%2?'#b7a77e':'#d0bb8b');}c.globalAlpha=(1-t)*.75;for(let k=0;k<(this.detail===0?2:4);k++){const a=k*1.9+event.tick,x=px+Math.cos(a)*t*24*scale,y=py+Math.sin(a)*t*9*scale-Math.sin(t*Math.PI)*9;poly(c,[[x-2,y],[x,y-3],[x+3,y],[x,y+1]],k%2?'#867451':'#b4a17a');}c.restore();}
  for(const p of s.projectiles){const total=Math.max(.001,p.total),flight=Math.max(0,Math.min(1,1-(p.life+(1-alpha)*.05)/total)),x=p.x+(p.tx-p.x)*flight,y=p.y+(p.ty-p.y)*flight;if(!player?.visible[Math.floor(y)*n+Math.floor(x)])continue;const px=(x-y)*32,py=(x+y)*16,startX=(p.x-p.y)*32,startY=(p.x+p.y)*16,tx=(p.tx-p.ty)*32,ty=(p.tx+p.ty)*16,height=p.style==='stone'?34:18,arc=Math.sin(flight*Math.PI)*height,a=Math.atan2(ty-startY-Math.cos(flight*Math.PI)*height*Math.PI,tx-startX);c.save();c.translate(px,py-arc-14);c.rotate(a);if(p.style==='stone'){ellipse(c,0,0,4.5,3.8,'#b7b39c');line(c,-3,-1,0,-3,'#d0cab1',1.2);}else{line(c,-7,0,3,0,'#e7d9b2',1.3);poly(c,[[4,0],[-1,-2],[-1,2]],'#e6dcc2');if(this.detail>0){line(c,-7,0,-10,-2,'#aab7a7',1);line(c,-7,0,-10,2,'#aab7a7',1);}}c.restore();}
  this.drawOrders(c,selected,s.tick);if(this.target){const elapsed=performance.now()-this.target.time;if(elapsed<850){const p=this.target,px=(p.x-p.y)*32,py=(p.x+p.y)*16,r=8+elapsed*.016;c.globalAlpha=1-elapsed/850;c.strokeStyle='#eadab2';c.lineWidth=1.5;for(let k=0;k<4;k++){const a=k*Math.PI*.5+Math.PI*.25;c.beginPath();c.moveTo(px+Math.cos(a)*r,py+Math.sin(a)*r*.5);c.lineTo(px+Math.cos(a)*(r+7),py+Math.sin(a)*(r+7)*.5);c.stroke();}c.globalAlpha=1;}}c.restore();
  if(this.drag){const r=this.canvas.getBoundingClientRect(),d=this.drag,x=Math.min(d.x1,d.x2)-r.left,y=Math.min(d.y1,d.y2)-r.top,w=Math.abs(d.x2-d.x1),h=Math.abs(d.y2-d.y1);c.fillStyle='rgba(111,200,196,.09)';c.fillRect(x,y,w,h);c.strokeStyle='rgba(158,225,214,.8)';c.lineWidth=1;c.strokeRect(x+.5,y+.5,w,h);}
  if(this.detail>0){const g=c.createRadialGradient(this.width*.5,this.height*.42,Math.min(this.width,this.height)*.25,this.width*.5,this.height*.42,Math.max(this.width,this.height)*.73);g.addColorStop(0,'rgba(12,23,20,0)');g.addColorStop(1,'rgba(9,18,16,.25)');c.fillStyle=g;c.fillRect(0,0,this.width,this.height);}this.adjustQuality(performance.now()-renderStart,renderStart);
 }
 private settlementWear(s:GameState):Map<number,number>{
  const n=s.map.size,wear=new Map<number,number>(),visible=s.players[0].visible;this.settlementPaths=[];
  const buildings=s.entities.filter(e=>e.kind==='building'&&e.hp>0&&this.isFriendly(e.owner));
  const centers=buildings.filter(e=>e.type==='towncenter');
  const sources=s.entities.filter(e=>e.kind==='resource'&&e.amount>0&&visible[Math.floor(e.y)*n+Math.floor(e.x)]);
  const trail=(a:Point,b:Point)=>{const distance=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.ceil(distance*2);if(distance>24)return;this.settlementPaths.push({a,b});for(let k=0;k<=steps;k++){const t=k/Math.max(1,steps),bend=Math.sin(t*Math.PI)*.55,x=a.x+(b.x-a.x)*t+bend,y=a.y+(b.y-a.y)*t-bend;for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const tx=Math.floor(x)+ox,ty=Math.floor(y)+oy;if(tx<0||ty<0||tx>=n||ty>=n)continue;const d=Math.hypot(tx+.5-x,ty+.5-y),strength=d<.55?2:d<1.1?1:0,i=ty*n+tx;if(strength>(wear.get(i)||0))wear.set(i,strength);}}};
  for(const tc of centers){for(const b of buildings)if(b.id!==tc.id&&b.owner===tc.owner&&Math.hypot(b.x-tc.x,b.y-tc.y)<20)trail(tc,b);for(const resource of ['food','wood']){let nearest:Entity|undefined,d=18;for(const source of sources){if(source.resource!==resource)continue;const distance=Math.hypot(source.x-tc.x,source.y-tc.y);if(distance<d){d=distance;nearest=source;}}if(nearest)trail(tc,nearest);}}
  return wear;
 }
 private drawSettlementTrails(c:CanvasRenderingContext2D,s:GameState){
  if(!this.settlementPaths.length)return;const paths=[new Path2D(),new Path2D()],n=s.map.size,p=s.players[0];
  for(const {a,b} of this.settlementPaths){const steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*3);let previous:Point|undefined;for(let k=0;k<=steps;k++){const t=k/Math.max(1,steps),bend=Math.sin(t*Math.PI)*.55,x=a.x+(b.x-a.x)*t+bend,y=a.y+(b.y-a.y)*t-bend,i=Math.floor(y)*n+Math.floor(x),point={x:(x-y)*32,y:(x+y)*16};if(previous&&p.explored[i]&&s.map.tiles[i]!==2){const path=paths[p.visible[i]?0:1];path.moveTo(previous.x,previous.y);path.lineTo(point.x,point.y);}previous=point;}}
  c.save();c.lineCap='round';c.lineJoin='round';for(let k=0;k<2;k++){c.globalAlpha=k?.2:.28;c.lineWidth=10;c.strokeStyle=k?'#796b4c':'#b7a271';c.stroke(paths[k]);c.globalAlpha=k?.16:.27;c.lineWidth=3;c.strokeStyle=k?'#8c7954':'#c6b17b';c.stroke(paths[k]);}c.restore();
 }
 private terrainTile(type:Terrain,variant:number,dim:number,road=0,deco=0){
  const key=`${type}/${variant}/${dim}/${this.detail}/${road}/${deco}`;let canvas=this.tiles.get(key);if(canvas)return canvas;
  canvas=document.createElement('canvas');canvas.width=66;canvas.height=36;const c=canvas.getContext('2d')!;
  const shades=[['#7d8958','#818d5a','#86915e','#899461','#8d9663','#8b9360'],['#9d9169','#a1946d','#978d65','#a39971'],['#467979','#4c8180','#548583','#4b7b7d'],['#b9b083','#c0b58a','#b6ad80','#bdb185']],f=dim?.43:1;
  poly(c,[[33,1],[66,18],[33,35],[0,18]],mix(shades[type][type===0?Math.min(5,Math.floor(variant/2)):variant%shades[type].length],f));
  c.save();c.beginPath();c.moveTo(33,1);c.lineTo(66,18);c.lineTo(33,35);c.lineTo(0,18);c.clip();
  if(type!==2){const g=c.createLinearGradient(10,0,46,36);g.addColorStop(0,'rgba(225,216,139,.025)');g.addColorStop(1,'rgba(51,66,36,.02)');c.fillStyle=g;c.fillRect(0,0,66,36);}
  if(road&&type!==2&&type!==3){c.globalAlpha=dim?.13:road===2?.19:.08;c.fillStyle=mix('#baa777',f);c.fillRect(0,0,66,36);c.globalAlpha=1;}
  if(type===0){for(let k=0;k<(this.detail===0?5:this.detail===1?12:20);k++){const x=hash(variant,k,1)*65,y=hash(variant,k,2)*34;line(c,x,y,x+2,y-2,mix(road?'#a79b6a':k%3?'#a2a471':'#62784b',f),.7);if(!road&&k%4===0)line(c,x,y,x-1,y-3,mix('#a9ac73',f),.7);}}
  else if(type===1||type===3){for(let k=0;k<(this.detail===0?4:10);k++)ellipse(c,hash(variant,k,1)*65,hash(variant,k,2)*34,hash(k,variant)*2+.3,.5,mix(k%2?'#8e865e':'#c6b98d',f));}
  else for(let k=0;k<5;k++){const x=hash(variant,k,2)*60,y=hash(variant,k,3)*34;line(c,x,y,x+9,y-1,mix(k%2?'#7fa59b':'#3f7274',f),.7);}
  if(type===0&&!road&&deco===1){ellipse(c,35,21,7,2,mix('#637544',f));ellipse(c,31,19,5,3,mix('#708951',f));ellipse(c,38,18,4,3,mix('#849759',f));line(c,33,21,34,16,mix('#9caa68',f),.8);}
  if(type!==2&&deco===2){poly(c,[[26,20],[28,16],[33,15],[36,19],[32,22]],mix('#9fa489',f));poly(c,[[28,16],[33,15],[31,19],[26,20]],mix('#c1bea0',f));ellipse(c,39,23,3,1.4,mix('#9da086',f));}
  if(type===0&&deco===3){for(let k=0;k<3;k++){const x=22+k*8,y=20+k%2*3;poly(c,[[x-4,y],[x-4,y-4],[x+2,y-6],[x+6,y-3],[x+6,y+1],[x,y+3]],mix(k===1?'#b5ac86':'#a69f7d',f));line(c,x-3,y-3,x+1,y-4,mix('#d0c297',f),1);}line(c,25,18,28,21,mix('#7c8063',f),1);}
  c.restore();this.tiles.set(key,canvas);return canvas;
 }
 private selectionRing(c:CanvasRenderingContext2D,e:Entity,selected:boolean){const color=this.isFriendly(e.owner)?'#b6ed9b':e.kind==='resource'?'#e0ce8f':'#e69d85';c.strokeStyle=color;c.lineWidth=selected?2:1.2;c.globalAlpha=selected?.95:.55;if(e.kind==='building'){const r=SIZES[e.type as BuildingType]*32;c.beginPath();c.moveTo(0,-r*.5);c.lineTo(r,0);c.lineTo(0,r*.5);c.lineTo(-r,0);c.closePath();c.stroke();}else{c.beginPath();c.ellipse(0,0,e.kind==='resource'?15:10,e.kind==='resource'?7:5,0,0,Math.PI*2);c.stroke();}c.globalAlpha=1;}
 private health(c:CanvasRenderingContext2D,e:Entity){const building=e.kind==='building',w=building?Math.min(63,SIZES[e.type as BuildingType]*20):24,y=building?-(e.type==='tower'?84:e.type==='towncenter'?67:e.type==='academy'?70:62)*artScale(e.type as BuildingType):(e.type==='cavalry'||e.type==='scout'?-56:-40),hp=Math.max(0,Math.min(1,e.hp/e.maxHp));c.fillStyle='rgba(15,22,19,.85)';c.fillRect(-w/2-1,y-1,w+2,5);c.fillStyle=hp>.5?'#93b875':hp>.25?'#d6bc75':'#c36f58';c.fillRect(-w/2,y,w*hp,3);if(building&&e.queue?.length){c.fillStyle='#4faaa9';c.fillRect(-w/2,y+6,w*Math.min(1,e.queue[0].progress/e.queue[0].time),2);}}
 private entitySprite(e:Entity,color:string):Sprite{
  let age=1;if(e.kind==='building'){if(this.isFriendly(e.owner)||this.engine?.isVisible(0,e)){age=this.engine?.state.players[e.owner]?.age||1;if(e.id)this.buildingAges.set(e.id,age);}else age=this.buildingAges.get(e.id)||1;}
  const ageVariant=e.type==='towncenter'?age:1,key=`${this.detail}/${e.type}/${e.kind==='building'?color:e.type==='tree'?e.id%7:''}/${e.completed?'built':'site'}/${ageVariant}`;
  let sprite=this.sprites.get(key);if(sprite)return sprite;const canvas=document.createElement('canvas'),building=e.kind==='building',scale=building?artScale(e.type as BuildingType):1,r=building?SIZES[e.type as BuildingType]*15:0;
  canvas.width=building?Math.ceil(Math.max(r+12,65)*2*scale+8):140;canvas.height=building?Math.ceil((100+r*.55)*scale+20):130;
  const ox=canvas.width/2,oy=building?Math.ceil(84*scale+10):110,c=canvas.getContext('2d')!;c.translate(ox,oy);
  if(!building){if(e.type==='tree')c.scale((e.id%2?-1:1)*(.87+hash(e.id%7,1)*.23),.88+hash(e.id%7,2)*.22);this.drawResource(c,e.type);}else{c.scale(scale,scale);this.drawBuilding(c,e.type as BuildingType,color,e.completed,ageVariant);}
  sprite={canvas,ox,oy};this.sprites.set(key,sprite);return sprite;
 }
 private drawResource(c:CanvasRenderingContext2D,type:string){
  if(type==='tree'){if(this.detail>0)ellipse(c,2,2,23,10,'rgba(32,43,25,.22)');poly(c,[[-4,1],[-3,-40],[2,-52],[6,-2]],'#615036');line(c,0,-26,-12,-43,'#6e5e3b',4);line(c,2,-25,16,-49,'#6a5837',3);const clusters=[[-15,-39,16,14,'#4c6240'],[12,-46,19,16,'#3e5b3b'],[-5,-60,21,17,'#5f7547'],[-20,-52,15,13,'#627a49'],[10,-65,17,15,'#6c804e'],[25,-49,12,12,'#526c42'],[-4,-76,14,11,'#7c8c56'],[-18,-64,13,11,'#71854f']];for(const[x,y,rx,ry,color]of clusters)ellipse(c,x as number,y as number,rx as number,ry as number,color as string);for(let k=0;k<(this.detail===0?0:this.detail===1?5:11);k++){const x=hash(k,4)*41-23,y=-72+hash(k,9)*32;line(c,x,y,x+5,y-1,'rgba(180,184,103,.24)',1.5);}}
  else if(type==='berries'){ellipse(c,0,2,18,7,'rgba(30,40,22,.2)');for(let k=0;k<7;k++){const x=hash(k,3)*26-13,y=-4-hash(k,7)*10;ellipse(c,x,y,8,7,k%2?'#617647':'#516a40');for(let j=0;j<3;j++)ellipse(c,x-3+j*3,y-2+(j%2)*3,1.5,1.4,'#a85849');}}
  else if(type==='deer'){ellipse(c,0,1,12,4,'rgba(30,40,22,.2)');line(c,-6,-7,-7,0,'#66523c',2);line(c,5,-7,6,0,'#66523c',2);ellipse(c,0,-11,10,5,'#b39465');poly(c,[[5,-12],[9,-23],[14,-22],[12,-12]],'#aa8658');ellipse(c,12,-23,4,3,'#c2a475');line(c,11,-25,9,-31,'#76664b',1);line(c,13,-25,15,-31,'#76664b',1);ellipse(c,14,-24,1,1,'#302f23');}
  else{ellipse(c,0,1,21,8,'rgba(36,38,27,.2)');const gold=type==='gold';poly(c,[[-20,0],[-16,-13],[-5,-20],[7,-18],[17,-9],[20,0],[5,6]],gold?'#9d9260':'#8f958a');poly(c,[[-16,-13],[-5,-20],[-2,-7],[-9,1],[-20,0]],gold?'#bbb078':'#b0b2a4');poly(c,[[-5,-20],[7,-18],[13,-8],[-2,-7]],gold?'#d1bd72':'#a2a99e');poly(c,[[13,-8],[17,-9],[20,0],[5,6],[4,-2]],gold?'#8c8255':'#727e75');if(gold){poly(c,[[-12,-9],[-7,-14],[-4,-9],[-6,-4]],'#e0c77c');poly(c,[[4,-13],[9,-12],[9,-7],[4,-8]],'#e1c479');poly(c,[[4,0],[8,-3],[12,0],[8,3]],'#bca559');}else line(c,-6,-16,-2,-8,'#737e76',1);}
 }
 private drawBuilding(c:CanvasRenderingContext2D,type:BuildingType,color:string,completed:boolean,age=1){
  const size=SIZES[type],r=size*15;if(this.detail>0)ellipse(c,5,6,r+5,r*.42+3,'rgba(34,37,25,.23)');
  if(type==='farm'){poly(c,[[0,-31],[61,0],[0,31],[-61,0]],'#88734b','#b4a06e');for(let i=-4;i<=4;i++){line(c,-45+i*4,-5-i*2,0+i*4,17-i*2,'#5d4e31',4);line(c,-45+i*4,-7-i*2,0+i*4,15-i*2,'#b8ad64',2);for(let j=0;j<5;j++){const x=-39+i*4+j*8,y=-7-i*2+j*4;line(c,x,y,x,y-5,'#b6b66c',1);line(c,x,y-2,x+2,y-4,'#c6bd78',.7);}}this.fence(c,[-58,1],[0,30],6);this.fence(c,[0,30],[58,1],6);return;}
  poly(c,[[0,-r*.5],[r,0],[0,r*.5],[-r,0]],type==='wall'||type==='gate'?'#a59f7d':'#ad9b70','#c6b18a');
  if(!completed){for(let k=0;k<4;k++){const x=(k%2?1:-1)*(r-7),y=k<2?0:-r*.25;line(c,x,y,x,y-30,'#85734e',3);line(c,x-5,y-9,x+6,y-9,'#b29865',2);}poly(c,[[-r+8,0],[0,-r*.4],[r-8,0],[0,r*.4]],'#8c7c57');for(let k=0;k<4;k++)line(c,-20+k*11,6-k*2,-10+k*11,10-k*2,'#b49c69',3);return;}
  if(type==='wall'||type==='gate'){this.wall(c,type,color);return;}if(type==='tower'){this.tower(c,0,2,color);return;}
  if(type==='towncenter'){
   const plaster=age===1?'#bfa67c':age===2?'#d1b98c':age===3?'#d7c6a3':'#c9c6ad';
   // A low civic hall and open courtyard, built from mud brick and timber.
   poly(c,[[0,-34],[70,1],[0,36],[-70,1]],'#bfaa7e','#d4bf92');
   poly(c,[[-47,15],[0,38],[47,15],[0,32]],'#a68f65');line(c,-41,20,0,40,'#d4be93',2);line(c,0,40,41,20,'#b9a37a',2);
   this.block(c,-7,-16,37,20,25,plaster);this.flatRoof(c,-7,-41,40,22,age>2?'#c8b997':'#b9a074',age>2?4:2);
   if(age===1){this.roof(c,-8,-43,37,18,3,'#b6a06a');for(let k=-2;k<=2;k++)line(c,-8+k*11,-52,-8+k*11,-34,'#8d774f',1);}
   this.block(c,-38,6,17,12,21,plaster);this.flatRoof(c,-38,-15,19,13,'#c6ac7f',3);
   this.block(c,36,9,18,12,22,plaster);this.flatRoof(c,36,-13,20,14,'#c5aa7c',3);
   this.door(c,-7,0,12,20);this.window(c,-28,-6);this.window(c,17,-6);this.door(c,-37,15,8,14);this.door(c,36,19,9,15);
   for(const x of[-21,7]){line(c,x,8,x,-22,age>=3?'#d8cbaa':'#8e7650',age>=3?4:3);ellipse(c,x,-22,4,1.5,'#e4ce9e');}
   poly(c,[[-24,-21],[3,-34],[17,-26],[-9,-12]],color,'#846d48');for(let k=0;k<3;k++)line(c,-20+k*10,-22-k*3,-7+k*9,-14-k*4,'rgba(240,222,169,.3)',1);
   ellipse(c,4,18,8,4,'#7f7659');ellipse(c,4,15,7,4,'#d1bd91');ellipse(c,4,15,4.5,2.4,'#526b61');line(c,-1,13,-1,4,'#9a8051',1.5);line(c,9,13,9,4,'#9a8051',1.5);line(c,-2,4,10,4,'#bca477',2);
   this.jar(c,-22,23,'#b27851');this.jar(c,24,21,'#c18c59');this.crate(c,-49,12);this.flag(c,48,-37,color,20);this.banner(c,-41,-20,color,18);
   ellipse(c,-7,-32,3,3,age>=3?'#b6944d':'#c8b37d');for(let k=0;k<age;k++)line(c,29+k*3,-9,29+k*3,-2,color,1.2);
   if(age>=3){for(let k=0;k<3;k++)line(c,-32+k*15,-14,-22+k*15,-9,'rgba(106,96,70,.2)',.7);this.block(c,-55,2,4,3,25,'#c8bfa0');this.block(c,55,2,4,3,25,'#c8bfa0');}
   if(age===4){this.banner(c,24,-30,color,17);line(c,-39,-44,-6,-61,'#b79854',2);line(c,-6,-61,32,-43,'#c9ad68',2);}
  }else if(type==='house'){
   this.block(c,0,3,25,16,19,'#c4ad83');this.roof(c,0,-16,29,19,6,'#baa369');this.door(c,-2,12,8,13);this.window(c,15,4);this.jar(c,-19,10,'#b68050');this.banner(c,12,-18,color,10);
  }else if(type==='granary'){
   for(const[x,y]of[[-15,-3],[9,-9],[14,9]]){line(c,x-9,y+7,x-9,y-3,'#87754e',2);line(c,x+8,y+7,x+8,y-3,'#87754e',2);ellipse(c,x,y-5,12,8,'#bda772');c.fillStyle='#bda772';c.fillRect(x-12,y-18,24,13);ellipse(c,x,y-18,12,6,'#d4bf87');poly(c,[[x-15,y-19],[x,y-31],[x+15,y-19],[x,y-12]],'#b6a268');line(c,x-11,y-10,x+10,y-10,'#8b794f',1);}
   this.fence(c,[-31,10],[4,27],4);this.jar(c,30,12,'#bbaa73');this.banner(c,-22,-26,color,15);
  }else if(type==='storage'){
   this.block(c,-7,-1,24,17,10,'#b39c71');this.flatRoof(c,-7,-11,27,19,'#bca77a',1);for(let k=0;k<4;k++)line(c,-25+k*10,-11,-15+k*10,-6,'#8d7751',2);this.crate(c,17,9);this.crate(c,27,14);this.crate(c,-25,10);this.jar(c,-9,15,'#c49f62');this.banner(c,-25,-12,color,10);for(let k=0;k<3;k++)line(c,4+k*5,14,17+k*5,8,'#856d43',3);
  }else if(type==='barracks'){
   this.block(c,-5,-6,31,20,22,'#c4ae85');this.flatRoof(c,-5,-28,35,23,'#b6a07a',3);this.door(c,-6,7,13,19);this.banner(c,18,-29,color,21);for(let k=0;k<4;k++){line(c,-29+k*5,14,-26+k*5,-12,'#7a6545',1.7);poly(c,[[-28+k*5,-12],[-25+k*5,-19],[-23+k*5,-11]],'#bcb396');}this.shield(c,29,10,color);this.shield(c,18,16,color,.7);this.fence(c,[-26,19],[1,32],3);
  }else if(type==='range'){
   this.block(c,-18,-4,20,16,16,'#c4b18b');this.roof(c,-18,-20,25,18,5,'#b5a06a');this.banner(c,-24,-23,color,14);for(let k=0;k<2;k++){line(c,14+k*14,7+k*6,18+k*14,-13+k*6,'#796443',2);ellipse(c,19+k*14,-14+k*6,8,10,'#d4c59b');ellipse(c,19+k*14,-14+k*6,5,7,'#a9684c');ellipse(c,19+k*14,-14+k*6,2,3,'#e0c88e');}this.fence(c,[-27,16],[4,31],4);
  }else if(type==='stable'){
   this.block(c,-12,-6,28,20,20,'#c4ae83');this.roof(c,-12,-26,34,24,6,'#ac965f');this.door(c,-12,6,19,17);this.banner(c,-29,-23,color,15);this.fence(c,[10,20],[43,3],5);this.fence(c,[10,20],[-5,28],3);ellipse(c,25,0,10,5,'#8b7151');line(c,19,2,18,9,'#5c4b35',2);line(c,31,1,32,7,'#5c4b35',2);poly(c,[[29,-1],[33,-12],[37,-12],[36,1]],'#9c8056');this.jar(c,4,19,'#b19058');
  }else if(type==='market'){
   this.block(c,-15,-11,25,17,18,'#c9b58c');this.flatRoof(c,-15,-29,29,20,'#c5aa7c',2);this.jar(c,-30,11,'#bf8053');for(let k=0;k<4;k++){const x=-22+k*14,y=8+k*.2;line(c,x,y+5,x,y-11,'#7b6442',2);poly(c,[[x-8,y-12],[x+5,y-18],[x+16,y-13],[x+2,y-5]],k%2?'#d4bf89':color,'#9d8254');this.crate(c,x+1,y+8);}ellipse(c,8,17,4,3,'#ac6745');ellipse(c,18,16,4,3,'#b9ac61');this.flag(c,-31,-42,color,18);
  }else if(type==='workshop'){
   this.block(c,-10,-4,30,20,20,'#b7a585');this.flatRoof(c,-10,-24,35,23,'#ad9876',2);this.door(c,-9,8,18,18);this.block(c,20,-13,6,6,31,'#a69e86');ellipse(c,29,11,11,7,'#5d5540');ellipse(c,29,11,7,4,'#ae9868');line(c,18,11,40,11,'#69583d',2);line(c,29,3,29,18,'#69583d',2);this.banner(c,-30,-24,color,17);this.crate(c,3,18);ellipse(c,14,-3,4,2,'#d19350');
  }else if(type==='academy'){
   this.block(c,0,-4,36,22,22,'#d0c09e');this.flatRoof(c,0,-26,41,25,'#bda982',3);for(let k=-2;k<=2;k++){const x=k*12;line(c,x,14,x,-13,'#e2d2ad',4);ellipse(c,x,-12,4,1.5,'#eadcba');ellipse(c,x,14,4,1.5,'#b9a57e');}poly(c,[[-36,-14],[0,-32],[36,-14],[0,-9]],'#cbb78e','#a39170');poly(c,[[-35,17],[0,34],[35,17],[0,27]],'#bdac85');line(c,-27,23,0,36,'#d9c49d',3);this.banner(c,24,-29,color,17);this.flag(c,-20,-45,color,14);
  }
  for(let k=0;k<(this.detail===0?0:3);k++)ellipse(c,-r+hash(k,size)*r*2,r*.18+hash(k,6)*6,2.5,1.3,'#8f8969');
 }
 private flatRoof(c:CanvasRenderingContext2D,x:number,y:number,w:number,d:number,fill:string,parapet=2){
  poly(c,[[x-w,y],[x,y-d],[x+w,y],[x,y+d]],fill,'#8d7b5b');line(c,x-w,y,x,y-d,mix(fill,1.18),parapet);line(c,x,y-d,x+w,y,mix(fill,1.1),parapet);line(c,x-w,y,x,y+d,mix(fill,.78),parapet);line(c,x,y+d,x+w,y,mix(fill,.85),parapet);for(let k=-2;k<=2;k++)line(c,x+k*w*.25,y-d*.55,x+k*w*.25+10,y-d*.55+5,'rgba(100,79,47,.12)',.7);
 }
 private jar(c:CanvasRenderingContext2D,x:number,y:number,color:string){ellipse(c,x,y+1,4.5,2,'rgba(62,52,34,.2)');ellipse(c,x,y-4,4.5,5.5,color);ellipse(c,x,y-9,2.8,1.4,mix(color,1.18));ellipse(c,x,y-9,1.5,.7,'#756043');line(c,x-2,y-6,x-2,y-3,'rgba(241,214,155,.35)',.8);}
 private block(c:CanvasRenderingContext2D,x:number,y:number,w:number,d:number,h:number,fill:string){poly(c,[[x-w,y],[x,y+d],[x,y+d-h],[x-w,y-h]],mix(fill,.88),'rgba(78,69,47,.25)');poly(c,[[x,y+d],[x+w,y],[x+w,y-h],[x,y+d-h]],mix(fill,1),'rgba(78,69,47,.25)');poly(c,[[x-w,y-h],[x,y-d-h],[x+w,y-h],[x,y+d-h]],mix(fill,1.08));line(c,x,y+d,x,y+d-h,'rgba(94,81,55,.35)',1);}
 private roof(c:CanvasRenderingContext2D,x:number,y:number,w:number,d:number,h:number,fill:string,trim?:string){poly(c,[[x-w,y],[x,y-d-h],[x+w,y],[x,y+d]],mix(fill,.92),'rgba(77,60,35,.3)');poly(c,[[x-w,y],[x,y-d-h],[x,y+d]],mix(fill,1.12));for(let i=1;i<7;i++){const t=i/7;line(c,x-w*(1-t),y+d*t,x,y-d-h+(d*2+h)*t,'rgba(75,58,34,.14)',1);}line(c,x-w,y,x,y+d,'#c1a475',2);line(c,x,y+d,x+w,y,'#8e7650',2);if(trim){line(c,x-w+3,y+1,x,y+d-1,trim,3);line(c,x,y+d-1,x+w-3,y+1,mix(trim,.8),3);}}
 private door(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number){poly(c,[[x-w/2,y],[x-w/2,y-h],[x+w/2,y-h+w*.5],[x+w/2,y+w*.5]],'#514b37');line(c,x,y-h+w*.25,x,y+w*.25,'#8c7951',1);ellipse(c,x+w*.23,y-h*.4,1,1,'#d7b776');}
 private window(c:CanvasRenderingContext2D,x:number,y:number){poly(c,[[x-3,y],[x-3,y-6],[x+3,y-9],[x+3,y-3]],'#5a5d47');line(c,x,y-7,x,y-1,'#aa9670',1);}
 private banner(c:CanvasRenderingContext2D,x:number,y:number,color:string,h:number){poly(c,[[x-3,y],[x+4,y-2],[x+4,y+h-4],[x,y+h],[x-3,y+h-2]],color);line(c,x-4,y,x+5,y-3,'#dfc695',1);}
 private flag(c:CanvasRenderingContext2D,x:number,y:number,color:string,h=22){line(c,x,y+h,x,y-9,'#695a3e',1.5);poly(c,[[x,y-9],[x+14,y-5],[x+11,y+2],[x,y-1]],color);line(c,x+1,y-8,x+12,y-5,'rgba(255,255,255,.2)',1);}
 private fence(c:CanvasRenderingContext2D,a:number[],b:number[],n:number){for(let i=0;i<=n;i++){const x=a[0]+(b[0]-a[0])*i/n,y=a[1]+(b[1]-a[1])*i/n;line(c,x,y,x,y-10,'#8a7950',2);}line(c,a[0],a[1]-7,b[0],b[1]-7,'#b39a65',1.5);line(c,a[0],a[1]-3,b[0],b[1]-3,'#9b865a',1.5);}
 private crate(c:CanvasRenderingContext2D,x:number,y:number){this.block(c,x,y,6,4,8,'#a18957');line(c,x-5,y-7,x,y+3,'#c3a36d',1);line(c,x,y+3,x+5,y-7,'#786542',1);}
 private tower(c:CanvasRenderingContext2D,x:number,y:number,color:string){this.block(c,x,y,14,9,48,'#b5ad93');for(let k=0;k<5;k++)line(c,x-13,y-5-k*8,x,y+2-k*8,'rgba(94,91,70,.23)',1);this.block(c,x,y-48,17,11,7,'#cbc1a3');for(let k=-1;k<=1;k++)this.block(c,x+k*11,y-45-Math.abs(k)*5,3.5,3,8,'#c8bea0');poly(c,[[x-3,y-27],[x-3,y-36],[x+2,y-38],[x+2,y-29]],'#5b6354');this.banner(c,x+6,y-41,color,21);this.flag(c,x,y-63,color,14);}
 private wall(c:CanvasRenderingContext2D,type:BuildingType,color:string){if(type==='gate'){this.block(c,-22,0,10,8,27,'#a9a68b');this.block(c,22,0,10,8,27,'#a9a68b');this.block(c,0,-22,24,8,10,'#c0b89b');poly(c,[[-12,7],[-12,-16],[0,-22],[12,-16],[12,7],[0,13]],'#685f44');for(let k=-2;k<=2;k++)line(c,k*5,9-Math.abs(k)*2,k*5,-18+Math.abs(k)*1.5,'#8c7a50',2);this.banner(c,-24,-25,color,14);this.banner(c,19,-25,color,14);}else{this.block(c,0,1,19,10,26,'#aaa78c');for(let k=-1;k<=1;k++)this.block(c,k*13,1-Math.abs(k)*6,4,4,32,'#bbb49a');for(let k=0;k<3;k++)line(c,-18,-4-k*7,0,5-k*7,'#8e917c',1);}}
 private construction(c:CanvasRenderingContext2D,e:Entity){const r=SIZES[e.type as BuildingType]*28,p=Math.max(0,Math.min(1,e.progress));c.globalAlpha=.85;for(const side of[-1,1]){const x=side*(r-5);line(c,x,1,x,-28-25*p,'#bc9c61',2);line(c,x-5,-12,x+5,-12,'#c8ae75',2);}line(c,-r+5,-26,r-5,-26,'#a18454',2);line(c,-r+5,1,r-5,-26,'#987e51',1);c.globalAlpha=1;c.fillStyle='#25362b';c.fillRect(-22,15,44,3);c.fillStyle='#c7b278';c.fillRect(-22,15,44*p,3);}
 /** All work and walking poses live in the same four bounded atlas pages. */
 private unitSprite(e:Entity,color:string,tick:number,alpha:number):UnitPose{
  const delta=Math.hypot(e.x-e.prevX,e.y-e.prevY),moving=delta>.005||e.task==='move'||e.task==='attackMove';
  const actualFacing=delta>.005?Math.atan2(e.y-e.prevY,e.x-e.prevX):e.facing;
  const facing=((Math.round((Number.isFinite(actualFacing)?actualFacing:0)/(Math.PI/4))%8)+8)%8;
  const gather=!moving&&e.task.startsWith('Gathering'),build=!moving&&(e.task==='Constructing'||e.task==='Repairing');
  const attacking=!moving&&e.cooldown>0&&(e.task==='Attacking'||e.orders[0]?.type==='attack');
  let state=attacking?'attack':build?'build':gather?'forage':moving?'walk':'idle';
  if(gather){const source=e.orders[0]?.target===undefined?undefined:this.engine?.get(e.orders[0].target);state=source?.type==='tree'?'chop':source?.type==='gold'||source?.type==='stone'?'mine':source?.type==='deer'?'hunt':source?.type==='farm'?'farm':'forage';}
  const phase=(tick+alpha)*.75+e.id*1.7,phases=6;
  const frame=moving?Math.floor(((phase%(Math.PI*2)+Math.PI*2)%(Math.PI*2))/(Math.PI*2)*phases):attacking?Math.max(0,Math.min(3,Math.floor((1-e.cooldown/(UNITS[e.type as UnitType]?.cooldown||1))*4))):build||gather?Math.floor((e.work*1.4%1)*4):0;
  const key=`${this.detail}/${e.type}/${color}/${facing}/${state}/${frame}/${e.carry>0?e.carryType||'carry':''}`;
  let sprite=this.unitSprites.get(key);if(sprite){this.unitCacheHits++;this.unitSprites.delete(key);this.unitSprites.set(key,sprite);return sprite;}
  this.unitCacheMisses++;let slot:number;if(this.unitSprites.size>=768){const oldest=this.unitSprites.keys().next().value!;slot=this.unitSprites.get(oldest)!.slot;this.unitSprites.delete(oldest);this.unitCacheEvictions++;}else slot=this.nextUnitSlot++;
  const page=Math.floor(slot/192),cell=slot%192,sx=cell%16*64,sy=Math.floor(cell/16)*80,ox=32,oy=68;let canvas=this.unitPages[page];if(!canvas){canvas=document.createElement('canvas');canvas.width=1024;canvas.height=960;this.unitPages[page]=canvas;}
  const oc=canvas.getContext('2d')!;oc.clearRect(sx,sy,64,80);oc.save();oc.translate(sx+ox,sy+oy);const pose={...e,id:0,facing:facing*Math.PI/4,prevX:moving?e.x-.1:e.x,prevY:e.y,task:moving?'move':e.task};const sample=moving?(frame+.5)/phases*Math.PI*2:0;
  this.paintUnit(oc,pose,color,sample/(moving?.75:.045),0,state,frame);oc.restore();sprite={canvas,ox,oy,sx,sy,slot};this.unitSprites.set(key,sprite);return sprite;
 }
 private drawUnit(c:CanvasRenderingContext2D,e:Entity,color:string,tick:number,alpha:number){const sp=this.unitSprite(e,color,tick,alpha);c.drawImage(sp.canvas,sp.sx,sp.sy,64,80,-sp.ox,-sp.oy,64,80);}
 private paintUnit(c:CanvasRenderingContext2D,e:Entity,color:string,tick:number,alpha:number,action='idle',frame=0){
  const moving=e.task==='move'||Math.hypot(e.x-e.prevX,e.y-e.prevY)>.005,phase=(tick+alpha)*.75+e.id*1.7,step=moving?Math.sin(phase)*3:0,facing=Number.isFinite(e.facing)?e.facing:0,dir=Math.cos(facing)-Math.sin(facing)<0?-1:1,working=['chop','mine','farm','forage','hunt','build'].includes(action),attack=action==='attack';
  if(this.detail>0)ellipse(c,1,1,e.type==='cavalry'||e.type==='scout'?13:e.type==='siege'?16:7,e.type==='cavalry'||e.type==='scout'?5:3,'rgba(22,32,22,.32)');c.save();c.scale(dir,1);c.transform(1,(Math.sin(facing)+Math.cos(facing))*.035,0,1,0,0);
  if(e.type==='siege'){line(c,-10,-5,12,-9,'#866e46',5);line(c,-12,-9,10,-14,'#b49964',3);const tip=attack&&frame===1?[-1,-34]:attack&&frame===2?[17,-21]:[13,-18];line(c,-7,-7,-1,-24,'#a58c58',3);line(c,-1,-24,tip[0],tip[1],'#c3a273',3);for(const x of[-10,10]){ellipse(c,x,-2,5,6,'#574f3a');ellipse(c,x,-2,3.3,4.3,'#aa9365');line(c,x-4,-2,x+4,-2,'#66583c',1);line(c,x,-7,x,3,'#66583c',1);}poly(c,[[-8,-12],[-1,-22],[6,-18],[1,-9]],color);if(!attack||frame!==2)ellipse(c,tip[0],tip[1]-2,4,3,'#a3a18b');c.restore();return;}
  const mounted=e.type==='cavalry'||e.type==='scout';let baseline=0;
  if(mounted){for(const[x,sign]of[[-8,1],[7,-1]]){line(c,x,-7,x+step*sign,-1,'#5e503b',2.2);line(c,x+step*sign,-1,x+step*sign+2,2,'#463e2e',1.8);}c.beginPath();c.moveTo(-13,-13);c.bezierCurveTo(-10,-23,5,-24,11,-16);c.lineTo(12,-27);c.lineTo(16,-32);c.lineTo(21,-27);c.lineTo(22,-22);c.lineTo(16,-21);c.lineTo(14,-10);c.bezierCurveTo(3,-6,-9,-6,-13,-13);c.fillStyle=e.type==='scout'?'#aa8c5e':'#80674a';c.fill();c.strokeStyle='#594d37';c.lineWidth=.7;c.stroke();line(c,-13,-15,-19,-10,'#534c35',2);poly(c,[[-5,-20],[5,-20],[8,-10],[-5,-9]],mix(color,.88));line(c,15,-28,18,-32,'#514831',2);line(c,13,-25,14,-14,'#514831',2);baseline=-14;}
  line(c,-3,baseline-11,-4-step*.55,baseline-3,'#675a42',3);line(c,3,baseline-11,4+step*.55,baseline-3,'#554b39',3);line(c,-4-step*.55,baseline-3,-2-step*.55,baseline-1,'#403b2b',2);line(c,4+step*.55,baseline-3,6+step*.55,baseline-1,'#403b2b',2);
  const armored=['heavy','spearman','cavalry'].includes(e.type),garment=e.type==='villager'?'#d1bd94':armored?'#bba77a':mix(color,.95),bob=moving?Math.abs(step)*.18:working&&frame===2?1:0;c.translate(0,-bob);
  poly(c,[[-4,baseline-24],[3,baseline-25],[6,baseline-12],[-6,baseline-12]],garment,'#4c4b35');poly(c,[[-4,baseline-21],[3,baseline-21],[4,baseline-15],[-5,baseline-15]],color);line(c,-5,baseline-12,6,baseline-12,'#675336',1.5);
  const handX=working?(frame===2?13:frame===1?9:6):attack?(frame===1?13:frame===2?10:8):8,handY=baseline+(working?(frame===0?-23:frame===1?-31:frame===2?-15:-18):-17-step*.25);
  line(c,-4,baseline-22,-7,baseline-15+step*.25,'#6c5940',3.3);line(c,-4,baseline-22,-7,baseline-15+step*.25,'#ccb08a',2.1);line(c,4,baseline-22,handX,handY,'#6c5940',3.3);line(c,4,baseline-22,handX,handY,'#d3b28a',2.2);
  ellipse(c,0,baseline-28,4,4.6,'#62573f');ellipse(c,0,baseline-28,3.3,4,'#d2b389');ellipse(c,-.7,baseline-31,3.8,2.2,e.type==='villager'?'#705b3b':'#665e43');
  if(armored){poly(c,[[-4,baseline-31],[0,baseline-34],[4,baseline-31],[4,baseline-27],[1,baseline-28],[-3,baseline-28]],'#c3b17f','#77724e');line(c,0,baseline-34,0,baseline-30,'#e2d1a0',1);if(e.type==='heavy')poly(c,[[-1,baseline-35],[0,baseline-40],[3,baseline-35],[2,baseline-32]],color);}
  if(e.type==='villager'){
   const toolX=handX+(working&&frame===0?-5:7),toolY=handY+(working?(frame===0?-12:frame===1?-7:frame===2?7:-4):-11);line(c,handX-2,handY+5,toolX,toolY,'#80643f',1.7);
   if(action==='build'){line(c,toolX-4,toolY,toolX+4,toolY,'#a9aa92',3);if(frame===2&&this.detail>0){line(c,toolX+1,toolY+2,toolX+5,toolY+1,'#e3ce91',1);line(c,toolX+2,toolY+3,toolX+4,toolY+6,'#d9bc78',1);}}
   else if(action==='mine'){poly(c,[[toolX-5,toolY+1],[toolX-1,toolY-2],[toolX+5,toolY],[toolX+7,toolY+3],[toolX+1,toolY+1]],'#b5b6a0');}
   else if(action==='chop'){poly(c,[[toolX-2,toolY-3],[toolX+5,toolY-4],[toolX+7,toolY+1],[toolX+1,toolY+3]],'#b7baa3','#6e7355');}
   else if(action==='farm'||action==='forage'){line(c,toolX-2,toolY,toolX+5,toolY+3,'#b8b794',2);if(action==='farm')for(let k=0;k<3;k++)line(c,toolX+k*2,toolY+2,toolX+k*2-1,toolY+5,'#8d8053',1);}
   else if(action==='hunt'){line(c,handX,handY+3,toolX+2,toolY-6,'#8c7750',1.6);poly(c,[[toolX,toolY-6],[toolX+3,toolY-11],[toolX+5,toolY-5]],'#c1c3a6');}
   else line(c,toolX-3,toolY,toolX+4,toolY+1,'#b2b59d',2);
   if(e.carry>0){if(e.carryType==='wood'){for(let k=0;k<3;k++)line(c,-11+k*3,baseline-23,-7+k*3,baseline-13,'#a28451',2.6);line(c,-12,baseline-18,-3,baseline-16,'#655738',1);}else{ellipse(c,-8,baseline-19,4.4,5.5,e.carryType==='food'?'#a4a065':e.carryType==='gold'?'#c3a860':e.carryType==='stone'?'#a5a58e':'#bba16a');line(c,-11,baseline-22,-5,baseline-22,'#796242',1);}}
  }else if(e.type==='archer'){
   const bowX=attack&&frame===1?13:9;c.strokeStyle='#aa8e56';c.lineWidth=1.5;c.beginPath();c.arc(bowX,baseline-21,9,-1.2,1.2);c.stroke();line(c,bowX+3,baseline-29,attack&&frame===0?bowX-2:bowX+3,baseline-21,'#e0d2a5',.7);line(c,attack&&frame===0?bowX-2:bowX+3,baseline-21,bowX+3,baseline-13,'#e0d2a5',.7);if(!attack||frame!==2)line(c,bowX-5,baseline-21,bowX+12,baseline-21,'#d8c895',1);poly(c,[[-5,baseline-29],[-10,baseline-16],[-6,baseline-14],[-2,baseline-27]],'#8c724b');
  }else if(e.type==='spearman'||e.type==='cavalry'){
   const tipX=attack&&frame===1?25:attack&&frame===2?19:11,tipY=baseline+(attack&&frame===1?-22:attack&&frame===2?-34:-43);line(c,8,baseline-6,tipX,tipY,'#79623f',1.7);poly(c,[[tipX-2,tipY],[tipX,tipY-6],[tipX+2,tipY+1]],'#c5c3a0');if(!mounted)this.shield(c,-7,baseline-17,color,.6);
  }else if(e.type==='infantry'||e.type==='heavy'){
   const tipX=attack&&frame===1?23:attack&&frame===0?5:12,tipY=baseline+(attack&&frame===1?-19:attack&&frame===0?-37:-30);line(c,handX,handY,tipX,tipY,e.type==='infantry'?'#82613e':'#d0c391',e.type==='infantry'?3:2.7);if(e.type==='infantry')ellipse(c,tipX,tipY,3.5,4.3,'#947047');else line(c,handX-3,handY-1,handX+3,handY+1,'#b99b5e',1.5);this.shield(c,-7,baseline-18,color,e.type==='heavy'?.85:.65);
  }else if(e.type==='scout')poly(c,[[-4,baseline-30],[0,baseline-34],[5,baseline-30],[4,baseline-27],[-4,baseline-27]],color);c.restore();
 }
 private shield(c:CanvasRenderingContext2D,x:number,y:number,color:string,scale=1){c.save();c.translate(x,y);c.scale(scale,scale);poly(c,[[-6,-7],[5,-9],[7,1],[1,9],[-5,4]],'#bda777','#766749');poly(c,[[-4,-5],[4,-7],[5,0],[0,7],[-3,3]],color);ellipse(c,0,-1,1.8,2.3,'#d8c89c');c.restore();}
 private rallyFlag(c:CanvasRenderingContext2D,x:number,y:number,color:string){c.save();c.globalAlpha=.9;ellipse(c,x,y,7,3,'rgba(196,217,165,.18)');c.strokeStyle=color;c.lineWidth=1;c.beginPath();c.ellipse(x,y,8,4,0,0,Math.PI*2);c.stroke();this.flag(c,x,y-19,color,19);c.restore();}
 private drawPlacement(c:CanvasRenderingContext2D){const p=this.placement!,x=(p.x-p.y)*32,y=(p.x+p.y)*16,r=SIZES[p.type]*32,col=p.valid?'#a9ddaa':'#e98b77';c.save();c.translate(x,y);c.globalAlpha=.2;poly(c,[[0,-r*.5],[r,0],[0,r*.5],[-r,0]],col);c.globalAlpha=.85;c.strokeStyle=col;c.lineWidth=1.5;c.beginPath();c.moveTo(0,-r*.5);c.lineTo(r,0);c.lineTo(0,r*.5);c.lineTo(-r,0);c.closePath();c.stroke();c.globalAlpha=.55;const fake={type:p.type,kind:'building',completed:true,owner:0}as Entity,sp=this.entitySprite(fake,this.engine?.state.players[0]?.color||TEAM);c.drawImage(sp.canvas,-sp.ox,-sp.oy);c.restore();}
 private drawOrders(c:CanvasRenderingContext2D,selected:Set<number>,tick:number){if(selected.size>14)return;const entities=this.engine!.state.entities;c.save();c.setLineDash([3,7]);c.lineDashOffset=-tick*.3;c.strokeStyle='rgba(220,219,169,.35)';c.lineWidth=1;for(const e of entities){if(!selected.has(e.id)||e.owner!==0||e.kind!=='unit'||!e.orders.length)continue;const order=e.orders[0];if(order.type==='hold')continue;let p:Point=order;if(order.target){const target=entities.find(t=>t.id===order.target);if(target){if(target.owner>0&&!this.engine!.state.players[0].visible[Math.floor(target.y)*this.engine!.state.map.size+Math.floor(target.x)])continue;p=target;}}c.beginPath();c.moveTo((e.x-e.y)*32,(e.x+e.y)*16);const path=e.path.slice(0,15);for(const q of path)c.lineTo((q.x-q.y)*32,(q.x+q.y)*16);if(!path.length)c.lineTo((p.x-p.y)*32,(p.x+p.y)*16);c.stroke();}c.restore();}
 drawMinimap(canvas:HTMLCanvasElement){const engine=this.engine;if(!engine)return;const s=engine.state,n=s.map.size,p=s.players[0],key=`${s.map.seed}/${s.map.generation}/${n}`;
  if(!this.mini||this.miniTick>s.tick||Math.floor(s.tick/8)!==Math.floor(this.miniTick/8)||key!==this.miniKey){
   if(!this.mini)this.mini=document.createElement('canvas');
   if(this.mini.width!==n||this.mini.height!==n){this.mini.width=n;this.mini.height=n;this.minimapPixels=undefined;}
   const mc=this.mini.getContext('2d')!;
   if(!this.minimapPixels)this.minimapPixels=mc.createImageData(n,n);
   const pixels=this.minimapPixels.data;
   const palette=[[126,133,95],[162,149,109],[82,123,124],[179,171,125]];
   const dimPalette=[[57,60,43],[73,67,49],[37,55,56],[81,77,56]],unknown=[23,34,30];
   // One numeric pixel per logical tile; no per-tile CSS parsing or canvas calls.
   for(let i=0;i<n*n;i++){const rgb=p.explored[i]?(p.visible[i]?palette[s.map.tiles[i]]:dimPalette[s.map.tiles[i]]):unknown,j=i*4;pixels[j]=rgb[0];pixels[j+1]=rgb[1];pixels[j+2]=rgb[2];pixels[j+3]=255;}
   mc.putImageData(this.minimapPixels,0,0);
   for(const e of s.entities){const visible=p.visible[Math.floor(e.y)*n+Math.floor(e.x)];if(e.owner!==0&&!visible)continue;
    if(e.kind==='resource'){if(!visible)continue;mc.fillStyle=e.type==='tree'?'#496242':e.type==='gold'?'#d1bb76':e.type==='berries'?'#aa8a67':'#a5aa96';mc.fillRect(e.x,e.y,.75,.75);}
    else{mc.fillStyle=s.players[e.owner]?.color||TEAM;const z=e.kind==='building'?2:1;mc.fillRect(e.x-z/2,e.y-z/2,z,z);if(e.owner>0&&this.isFriendly(e.owner)){mc.strokeStyle='#cee8a6';mc.lineWidth=.6;mc.strokeRect(e.x-z/2-.5,e.y-z/2-.5,z+1,z+1);}}}
   this.miniTick=s.tick;this.miniKey=key;
  }
  const c=canvas.getContext('2d');if(!c)return;const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2),w=Math.round((rect.width||160)*dpr),h=Math.round((rect.height||160)*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}c.setTransform(1,0,0,1,0,0);c.imageSmoothingEnabled=false;c.fillStyle='#17221e';c.fillRect(0,0,w,h);c.drawImage(this.mini!,0,0,w,h);
  // The explicitly enabled late-game aid marks positions only on the minimap.
  // It does not change sight, explored land, entity rendering or selection.
  if(s.settings.cleanup&&s.tick>=24000){
   const pulse=(s.tick%40)/40,r=(2.5+pulse*3)*dpr;c.save();c.strokeStyle='#e4c780';c.lineWidth=Math.max(1,dpr*.8);c.globalAlpha=.85-pulse*.45;
   for(const e of s.entities){if(this.isFriendly(e.owner)||e.owner<0||e.hp<=0||(e.kind!=='unit'&&e.kind!=='building'))continue;const x=e.x/n*w,y=e.y/n*h;c.beginPath();c.ellipse(x,y,r,r,0,0,Math.PI*2);c.moveTo(x-r-2*dpr,y);c.lineTo(x-1*dpr,y);c.moveTo(x+1*dpr,y);c.lineTo(x+r+2*dpr,y);c.moveTo(x,y-r-2*dpr);c.lineTo(x,y-1*dpr);c.moveTo(x,y+1*dpr);c.lineTo(x,y+r+2*dpr);c.stroke();}
   c.restore();
  }
  c.strokeStyle='rgba(236,227,191,.8)';c.lineWidth=Math.max(1,dpr*.8);c.beginPath();const corners=[this.localWorld(0,65),this.localWorld(this.width,65),this.localWorld(this.width,this.height-185),this.localWorld(0,this.height-185)];corners.forEach((p,i)=>i?c.lineTo(p.x/n*w,p.y/n*h):c.moveTo(p.x/n*w,p.y/n*h));c.closePath();c.stroke();
 }
 drawPortrait(canvas:HTMLCanvasElement,entity:Entity):void{
  const c=canvas.getContext('2d');if(!c)return;const rect=canvas.getBoundingClientRect(),w=rect.width||80,h=rect.height||76,dpr=Math.min(window.devicePixelRatio||1,2);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);const bg=c.createLinearGradient(0,0,w,h);bg.addColorStop(0,'#344333');bg.addColorStop(1,'#17271f');c.fillStyle=bg;c.fillRect(0,0,w,h);
  if(entity.owner!==0&&!this.isFriendly(entity.owner)&&!this.engine?.isVisible(0,entity))return;
  const color=this.engine?.state.players[entity.owner]?.color||TEAM;let image:HTMLCanvasElement,sx:number,sy:number,sw:number,sh:number;
  if(entity.kind==='unit'){const sp=this.unitSprite(entity,color,this.engine?.state.tick||0,1),mounted=entity.type==='cavalry'||entity.type==='scout',up=mounted?65:entity.type==='spearman'?54:entity.type==='heavy'?44:entity.type==='siege'?37:41,active=entity.task==='Attacking'||entity.task==='Constructing'||entity.task==='Repairing'||entity.task.startsWith('Gathering');image=sp.canvas;sw=mounted?56:active?56:entity.type==='siege'?44:46;sx=sp.sx+32-sw/2;sy=sp.sy+68-up;sh=up+8;}
  else{const sp=this.entitySprite(entity,color);image=sp.canvas;const scale=entity.kind==='building'?artScale(entity.type as BuildingType):1,r=entity.kind==='building'?(entity.type==='towncenter'?82:entity.type==='farm'?65:entity.type==='market'?58:entity.type==='granary'?48:43)*scale:entity.type==='tree'?37:26,up=entity.kind==='building'?(entity.type==='tower'?85:entity.type==='towncenter'?70:entity.type==='academy'?66:56)*scale:entity.type==='tree'?91:36,down=entity.kind==='building'?SIZES[entity.type as BuildingType]*9*scale:10;sx=sp.ox-r;sy=sp.oy-up;sw=r*2;sh=up+down;}
  const scale=Math.min((w-8)/sw,(h-7)/sh),dw=sw*scale,dh=sh*scale;c.imageSmoothingEnabled=true;c.drawImage(image,sx,sy,sw,sh,(w-dw)/2,(h-dh)/2,dw,dh);
 }
 minimapWorld(clientX:number,clientY:number,canvas:HTMLCanvasElement):Point{const r=canvas.getBoundingClientRect(),n=this.engine?.state.map.size||64;return{x:Math.max(0,Math.min(n-1,(clientX-r.left)/r.width*n)),y:Math.max(0,Math.min(n-1,(clientY-r.top)/r.height*n))};}
 destroy(){this.disposed=true;this.tiles.clear();this.sprites.clear();this.clearUnitSprites();this.minimapPixels=undefined;this.unitPages=[];this.engine=undefined;this.terrainLayer=undefined;this.mini=undefined;}
}
