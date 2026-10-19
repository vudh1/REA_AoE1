import type {BuildingType, Command, Entity, GameState, MatchSettings, Order, Player, Point, QueueItem, Resource, Result, Stock, TechId, UnitDef, UnitType} from './types';
import {UNITS, BUILDINGS, TECHS, stock} from './data';
import {generateMap} from './map';
import {findPath, isWalkable} from './pathfinding';
import {updateAI} from './ai';
import {decodeSave, encodeSave} from './persistence';

const DT=1/20, RES:Resource[]=['food','wood','gold','stone'];
const ok=(id?:number):Result=>({ok:true,id});
const fail=(reason:string):Result=>({ok:false,reason});
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const finitePoint=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y);
const freshStats=()=>({gathered:0,trained:0,lost:0,kills:0,built:0,destroyed:0});

/** Fixed-step deterministic simulation. Rendering and wall clocks never advance rules. */
export class Engine {
 state:GameState;
 metrics={simulationMs:0,pathQueue:0,aiMs:0};
 private ids=new Map<number,Entity>();
 private buckets=new Map<number,Entity[]>();
 private bucketWidth=1;
 private pathBudget=6;
 private fogDirty=true;
 private blocked=new Uint8Array(0);
 private gates=new Int8Array(0);
 private notices=new Map<string,number>();
 constructor(settings:MatchSettings,state?:GameState) {
  if(state) { this.state=state; this.reindex(); this.fogDirty=false; return; }
  const generated=generateMap(settings);
  const players:Player[]=[];
  const rgb=(color:string)=>{const hex=color.replace('#','');return [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));};
  const humanColor=rgb(settings.color);
  const palette=['#d36c54','#d5af54','#9e82cc','#5cbdc6','#507cc9','#97ad4e','#ee4035','#ffd633','#244a9c','#25252f','#fff2ba'];
  const colors=[settings.color,...palette.filter(color=>rgb(color).reduce((sum,c,i)=>sum+(c-humanColor[i]!)**2,0)>=100**2)];
  const civs=['river','highland','steppe'] as const;
  for(let i=0;i<=settings.opponents+(settings.allies??0);i++) {
   const allied=i>settings.opponents;
   const civ=i===0?settings.civ:settings.aiCiv==='random'?civs[i%3]!:settings.aiCiv;
   players.push({id:i,team:allied?0:i,name:i===0?'Your kingdom':allied?`Allied kingdom ${i-settings.opponents}`:`Kingdom ${i+1}`,civ,color:colors[i%colors.length]!,age:1,resources:settings.resources==='abundant'?stock({food:650,wood:650,gold:350,stone:350}):stock({food:260,wood:240,gold:100,stone:150}),techs:[],defeated:false,stats:freshStats(),explored:new Array(generated.map.size**2).fill(0),visible:new Array(generated.map.size**2).fill(0),memory:{},...(i?{ai:{nextDecision:0,phase:'opening',nextAttack:0,scoutIndex:0,lastBuild:0}}:{})});
  }
  this.state={version:1,settings:{...settings},map:generated.map,tick:0,nextId:Math.max(0,...generated.resources.map(e=>e.id))+1,rng:2166136261,entities:generated.resources,players,projectiles:[],events:[],paused:false,result:'playing',tutorialStep:0};
  for(const p of players) {
   const start=this.state.map.starts[p.id]!;
   this.createBuilding(p.id,'towncenter',start.x,start.y);
   for(let i=0;i<5;i++) this.createUnit(p.id,'villager',start.x-3+i*1.1,start.y+3.8);
   this.createUnit(p.id,'scout',start.x+4,start.y+2.7);
  }
  this.reindex(); this.updateFog();
 }
 get(id:number) {return this.ids.get(id);}
 areAllied(a:number,b:number):boolean {
  const first=this.state.players[a],second=this.state.players[b];
  return a>=0&&b>=0&&!!first&&!!second&&(first.team??first.id)===(second.team??second.id);
 }
 isHostile(a:number,b:number):boolean {
  return a>=0&&b>=0&&!!this.state.players[a]&&!!this.state.players[b]&&!this.areAllied(a,b);
 }
 private alliedOwners(owner:number) {return this.state.players.filter(player=>this.areAllied(owner,player.id)).map(player=>player.id);}
 private reindex() {
  this.ids.clear();
  for(const bucket of this.buckets.values())bucket.length=0;
  const size=this.state.map.size;
  this.bucketWidth=Math.ceil(size/6);
  if(this.blocked.length!==size*size){this.blocked=new Uint8Array(size*size);this.gates=new Int8Array(size*size);}else this.blocked.fill(0);
  this.gates.fill(-1);
  for(let i=0;i<this.blocked.length;i++)if(this.state.map.tiles[i]===2)this.blocked[i]=1;
  for(const e of this.state.entities) {
   if(e.hp<=0) continue;
   this.ids.set(e.id,e);
   if(e.kind==='resource'&&e.amount>0)this.blocked[Math.floor(e.y)*size+Math.floor(e.x)]=1;
   if(e.kind==='building'&&!(e.type==='gate'&&e.open)) {
    for(let y=Math.max(0,Math.floor(e.y-e.radius));y<Math.min(size,e.y+e.radius);y++)for(let x=Math.max(0,Math.floor(e.x-e.radius));x<Math.min(size,e.x+e.radius);x++) {
     if(e.type==='gate')this.gates[y*size+x]=e.owner;else this.blocked[y*size+x]=1;
    }
   }
   const k=Math.floor(e.y/6)*this.bucketWidth+Math.floor(e.x/6);
   let b=this.buckets.get(k);if(!b)this.buckets.set(k,b=[]);b.push(e);
  }
 }
 entitiesNear(x:number,y:number,r:number):Entity[] {
  const found:Entity[]=[];
  for(let cy=Math.max(0,Math.floor((y-r)/6));cy<=Math.min(this.bucketWidth-1,Math.floor((y+r)/6));cy++)for(let cx=Math.max(0,Math.floor((x-r)/6));cx<=Math.min(this.bucketWidth-1,Math.floor((x+r)/6));cx++) {
   for(const e of this.buckets.get(cy*this.bucketWidth+cx)??[])if(e.hp>0&&(x-e.x)**2+(y-e.y)**2<=(r+e.radius)**2)found.push(e);
  }
  return found;
 }
 population(owner:number) {
  let current=0,reserved=0,cap=0;
  for(const e of this.state.entities) if(e.owner===owner&&e.hp>0) {
   if(e.kind==='unit')current+=UNITS[e.type as UnitType].population;
   else if(e.kind==='building') {
    if(e.completed)cap+=BUILDINGS[e.type as BuildingType].population??0;
    reserved+=e.queue.reduce((sum,q)=>sum+q.population,0);
   }
  }
  return {current,reserved,cap:Math.min(this.state.settings.population,cap)};
 }
 private entity(owner:number,kind:Entity['kind'],type:Entity['type'],x:number,y:number,hp:number,radius:number,completed=true):Entity {
  const e:Entity={id:this.state.nextId++,owner,kind,type,x,y,prevX:x,prevY:y,hp,maxHp:hp,radius,completed,progress:completed?1:0,amount:0,carry:0,orders:[],path:[],cooldown:0,work:0,queue:[],task:'Idle',facing:0,stuck:0,repath:0,lastHit:-9999};
  this.state.entities.push(e);this.ids.set(e.id,e);
  this.bucketWidth=Math.ceil(this.state.map.size/6);
  const key=Math.floor(y/6)*this.bucketWidth+Math.floor(x/6);let bucket=this.buckets.get(key);if(!bucket)this.buckets.set(key,bucket=[]);bucket.push(e);
  return e;
 }
 createUnit(owner:number,type:UnitType,x:number,y:number):Entity {
  const p=this.state.players[owner]!,def=UNITS[type];
  const health=(p.techs.includes('health')?1.2:1)*(p.civ==='highland'&&['infantry','heavy','spearman'].includes(type)?1.1:1);
  return this.entity(owner,'unit',type,x,y,Math.round(def.hp*health),type==='siege'?.43:.25);
 }
 createBuilding(owner:number,type:BuildingType,x:number,y:number,completed=true):Entity {
  const p=this.state.players[owner]!,def=BUILDINGS[type];
  const health=(p.techs.includes('durability')?1.2:1)*(p.civ==='highland'&&['tower','wall','gate'].includes(type)?1.15:1);
  const e=this.entity(owner,'building',type,x,y,Math.round(def.hp*health),def.size/2,completed);
  if(!completed)e.hp=Math.max(1,e.maxHp*.05);
  if(type==='farm'){e.amount=350;e.resource='food';}
  if(type==='gate')e.open=false;
  this.fogDirty=true;return e;
 }
 unitStats(e:Entity):UnitDef {
  const def=UNITS[e.type as UnitType],p=this.state.players[e.owner]!;
  return {...def,damage:def.damage+(p.techs.includes('infantry')&&['infantry','heavy','spearman'].includes(e.type)?2:0)+(p.techs.includes('ranged')&&e.type==='archer'?2:0),armor:def.armor+(p.techs.includes('armor')&&e.type!=='villager'?1:0),speed:def.speed*(p.civ==='steppe'&&e.type==='cavalry'?1.1:1),sight:def.sight+(p.civ==='steppe'&&e.type==='scout'?2:0)};
 }
 emit(type:string,owner:number,text:string,x?:number,y?:number,entity?:number) {
  this.state.events.push({tick:this.state.tick,type,owner,text,x,y,entity});
  if(this.state.events.length>150)this.state.events.splice(0,this.state.events.length-150);
 }
 private notice(e:Entity,text:string) {
  const key=`${e.id}:${text}`;
  if(this.state.tick-(this.notices.get(key)??-1000)>120){this.emit('warning',e.owner,text,e.x,e.y,e.id);this.notices.set(key,this.state.tick);}
 }
 private afford(owner:number,cost:Partial<Stock>) {return RES.every(r=>this.state.players[owner]!.resources[r]>=(cost[r]??0));}
 private spend(owner:number,cost:Partial<Stock>,factor=1) {for(const r of RES)this.state.players[owner]!.resources[r]-=(cost[r]??0)*factor;}
 private refund(owner:number,cost:Stock,factor=1) {for(const r of RES)this.state.players[owner]!.resources[r]+=cost[r]*factor;}
 private hasBuilding(owner:number,type:BuildingType) {return this.state.entities.some(e=>e.owner===owner&&e.kind==='building'&&e.type===type&&e.completed&&e.hp>0);}
 canPlace(owner:number,type:BuildingType,x:number,y:number):Result {
  const p=this.state.players[owner],def=BUILDINGS[type];
  if(!p||!def||!finitePoint({x,y}))return fail('Invalid building or location.');
  if(p.defeated)return fail('This kingdom has been defeated.');
  if(p.age<def.age)return fail(`Requires age ${def.age}.`);
  if(def.requires&&!this.hasBuilding(owner,def.requires))return fail(`Requires ${BUILDINGS[def.requires].name}.`);
  if(!this.afford(owner,def.cost))return fail('Insufficient resources.');
  const left=Math.floor(x),top=Math.floor(y),s=this.state.map.size;
  if(left<1||top<1||left+def.size>=s-1||top+def.size>=s-1)return fail('Outside the buildable map.');
  for(let ty=top;ty<top+def.size;ty++)for(let tx=left;tx<left+def.size;tx++) {
   if(!p.explored[ty*s+tx])return fail('Explore this land before building.');
   if(!p.visible[ty*s+tx])return fail('Bring a unit into sight before placing foundations.');
   if(this.state.map.tiles[ty*s+tx]===2)return fail('Buildings require dry land.');
  }
  const center={x:left+def.size/2,y:top+def.size/2};
  for(const e of this.state.entities)if(e.hp>0) {
   if(e.kind==='unit') {
    if(Math.abs(e.x-center.x)<def.size/2+e.radius&&Math.abs(e.y-center.y)<def.size/2+e.radius)return fail('A unit is standing on this foundation.');
   }else if(e.kind==='building') {
    if(Math.abs(e.x-center.x)<def.size/2+e.radius-.05&&Math.abs(e.y-center.y)<def.size/2+e.radius-.05)return fail('Another building occupies this ground.');
   }else if(e.amount>0&&Math.abs(e.x-center.x)<def.size/2+e.radius&&Math.abs(e.y-center.y)<def.size/2+e.radius)return fail('Resources occupy this ground.');
  }
  return ok();
 }
 command(owner:number,cmd:Command):Result {
  const p=this.state.players[owner];
  if(!p||p.defeated||this.state.result!=='playing')return fail('The match has ended.');
  if(cmd.type==='resign') {
   for(const e of this.state.entities)if(e.owner===owner)e.hp=0;
   p.defeated=true;this.cleanup();this.checkVictory();return ok();
  }
  if(cmd.type==='build') {
   const result=this.canPlace(owner,cmd.building,cmd.x,cmd.y);if(!result.ok)return result;
   const builders=cmd.builders.map(id=>this.get(id)).filter((e):e is Entity=>!!e&&e.owner===owner&&e.type==='villager'&&e.kind==='unit');
   if(!builders.length)return fail('Select a villager to construct this building.');
   const def=BUILDINGS[cmd.building];this.spend(owner,def.cost);
   const e=this.createBuilding(owner,cmd.building,Math.floor(cmd.x)+def.size/2,Math.floor(cmd.y)+def.size/2,false);
   for(const u of builders)this.setOrder(u,{type:'build',target:e.id,x:e.x,y:e.y},false);
   this.reindex();return ok(e.id);
  }
  if(cmd.type==='order') {
   if(!['move','attackMove','attack','gather','build','repair','deposit','hold','stop'].includes(cmd.order.type))return fail('Unknown unit order.');
   if(!finitePoint(cmd.order)||cmd.order.x<0||cmd.order.y<0||cmd.order.x>=this.state.map.size||cmd.order.y>=this.state.map.size)return fail('That location is outside the map.');
   const selected=[...new Set(cmd.ids)].map(id=>this.get(id)).filter((e):e is Entity=>!!e&&e.owner===owner&&e.kind==='unit'&&e.hp>0);
   if(!selected.length)return fail('Select your units first.');
   const target=cmd.order.target===undefined?undefined:this.get(cmd.order.target);
   if(['attack','gather','build','repair','deposit'].includes(cmd.order.type)&&!target)return fail('This target no longer exists.');
   if(target&&target.owner!==owner&&!this.isVisible(owner,target))return fail('This target is outside your sight.');
   if(cmd.order.type==='attack'&&(target!.owner<0||!this.isHostile(owner,target!.owner)||this.state.settings.peaceful))return fail('Choose a hostile unit or building.');
   if(cmd.order.type==='gather'&&!(target!.kind==='resource'||target!.type==='farm'&&target!.owner===owner&&target!.completed))return fail('This is not a usable resource.');
   if(cmd.order.type==='build'&&!(target!.kind==='building'&&target!.owner===owner&&!target!.completed))return fail('Choose an unfinished friendly building.');
   if(cmd.order.type==='repair'&&!(target!.kind==='building'&&target!.owner===owner&&target!.completed&&target!.hp<target!.maxHp))return fail('Choose a damaged friendly building.');
   if(cmd.order.type==='deposit'&&!(target!.kind==='building'&&target!.owner===owner&&target!.completed&&BUILDINGS[target!.type as BuildingType].dropoff))return fail('Choose a completed drop-off building.');
   let count=0;
   for(let i=0;i<selected.length;i++) {
    const e=selected[i]!;
    if(['gather','build','repair','deposit'].includes(cmd.order.type)&&e.type!=='villager')continue;
    if(cmd.order.type==='deposit'&&(!e.carryType||!BUILDINGS[target!.type as BuildingType].dropoff?.includes(e.carryType)))continue;
    const order={...cmd.order};
    if(order.type==='stop'){e.orders=[];e.path=[];e.home=undefined;e.task='Idle';e.stuck=0;e.repath=0;count++;continue;}
    if((order.type==='move'||order.type==='attackMove')&&selected.length>1) {
     const side=Math.ceil(Math.sqrt(selected.length));order.x=Math.max(.5,Math.min(this.state.map.size-.5,order.x+(i%side-(side-1)/2)*.85));order.y=Math.max(.5,Math.min(this.state.map.size-.5,order.y+(Math.floor(i/side)-(side-1)/2)*.85));
    }
    if(e.orders.length>=32&&cmd.queue)continue;
    this.setOrder(e,order,!!cmd.queue);count++;
   }
   return count?ok():fail('The selected units cannot perform this task.');
  }
  if(cmd.type==='train') {
   const def=UNITS[cmd.unit];if(!def)return fail('Unknown unit.');
   if(p.age<def.age)return fail(`Requires age ${def.age}.`);
   const buildings=cmd.ids.map(id=>this.get(id)).filter((e):e is Entity=>!!e&&e.owner===owner&&e.kind==='building'&&e.completed&&e.hp>0&&BUILDINGS[e.type as BuildingType].produces?.includes(cmd.unit)===true).sort((a,b)=>a.queue.length-b.queue.length);
   const b=buildings[0];if(!b)return fail(`Requires a completed ${BUILDINGS[def.building].name}.`);
   if(b.queue.length>=12)return fail('Production queue is full.');
   const pop=this.population(owner);if(pop.current+pop.reserved+def.population>pop.cap)return fail('Population limit reached. Build a house.');
   if(!this.afford(owner,def.cost))return fail('Insufficient resources.');
   this.spend(owner,def.cost);b.queue.push({kind:'unit',type:cmd.unit,progress:0,time:def.time,cost:stock(def.cost),population:def.population});return ok(b.id);
  }
  if(cmd.type==='research') {
   const def=TECHS[cmd.tech],b=this.get(cmd.id);
   if(!def||!b||b.owner!==owner||b.kind!=='building'||!b.completed||b.type!==def.building)return fail('Select the appropriate completed research building.');
   if(p.techs.includes(cmd.tech)||this.state.entities.some(e=>e.owner===owner&&e.queue.some(q=>q.kind==='tech'&&q.type===cmd.tech)))return fail('This technology is already researched or queued.');
   if(p.age<def.age)return fail(`Requires age ${def.age}.`);
   if(cmd.tech.startsWith('age')&&p.age!==Number(cmd.tech.slice(3))-1)return fail('Advance one age at a time.');
   for(const type of def.requires??[])if(!this.hasBuilding(owner,type))return fail(`Requires ${BUILDINGS[type].name}.`);
   if(b.queue.length>=12)return fail('Production queue is full.');
   if(!this.afford(owner,def.cost))return fail('Insufficient resources.');
   this.spend(owner,def.cost);b.queue.push({kind:'tech',type:cmd.tech,progress:0,time:def.time,cost:stock(def.cost),population:0});return ok();
  }
  if(cmd.type==='cancel') {
   const e=this.get(cmd.id);if(!e||e.owner!==owner||e.kind!=='building')return fail('Choose your building.');
   if(!e.completed) {this.refund(owner,stock(BUILDINGS[e.type as BuildingType].cost),.75);e.hp=0;this.cleanup();return ok();}
   const index=cmd.index??0;if(!Number.isInteger(index)||index<0||index>=e.queue.length)return fail('This queue entry no longer exists.');
   const item=e.queue.splice(index,1)[0]!;this.refund(owner,item.cost);return ok();
  }
  if(cmd.type==='rally') {
   if(!finitePoint(cmd)||cmd.x<0||cmd.y<0||cmd.x>=this.state.map.size||cmd.y>=this.state.map.size)return fail('Invalid rally point.');
   let count=0;for(const id of cmd.ids){const b=this.get(id);if(b&&b.owner===owner&&b.kind==='building'){b.rally={x:cmd.x,y:cmd.y};count++;}}
   return count?ok():fail('Select a production building.');
  }
  if(cmd.type==='gate') {
   const e=this.get(cmd.id);if(!e||e.owner!==owner||e.type!=='gate'||!e.completed)return fail('Select your completed gate.');
   if(e.open&&this.state.entities.some(u=>u.hp>0&&u.kind==='unit'&&this.isHostile(owner,u.owner)&&Math.abs(u.x-e.x)<e.radius+u.radius&&Math.abs(u.y-e.y)<e.radius+u.radius))return fail('A foreign unit is inside the gate. Wait until it has passed before closing.');
   e.open=!e.open;for(const u of this.state.entities)if(u.kind==='unit')u.repath=0;return ok();
  }
  return fail('Unknown command.');
 }
 private setOrder(e:Entity,order:Order,append:boolean) {
  if(!append){e.orders=[];e.path=[];e.home=undefined;e.stuck=0;e.repath=0;}
  if(order.type==='gather'&&order.target!==undefined)order.resource=this.get(order.target)?.resource;
  e.orders.push(order);e.task=order.type==='hold'?'Holding position':order.type;
 }
 private finishOrder(e:Entity) {e.orders.shift();e.path=[];e.repath=0;e.stuck=0;e.home=undefined;if(!e.orders.length)e.task='Idle';}
 private edgeDistance(e:Point,t:Entity) {
  return t.kind==='building'?Math.hypot(Math.max(0,Math.abs(e.x-t.x)-t.radius),Math.max(0,Math.abs(e.y-t.y)-t.radius)):Math.max(0,distance(e,t)-t.radius);
 }
 private canStand(e:Entity,x:number,y:number) {
  const r=e.radius*.75,s=this.state.map.size;
  const left=Math.floor(x-r),right=Math.floor(x+r),top=Math.floor(y-r),bottom=Math.floor(y+r);
  if(left<0||top<0||right>=s||bottom>=s)return false;
  const free=(index:number)=>!this.blocked[index]&&(this.gates[index]<0||this.areAllied(this.gates[index]!,e.owner));
  return free(Math.floor(y)*s+Math.floor(x))&&free(top*s+left)&&free(top*s+right)&&free(bottom*s+left)&&free(bottom*s+right);
 }
 private walk(e:Entity,target:Point,reach=.15):boolean {
  if(distance(e,target)<=reach){e.path=[];e.stuck=0;return true;}
  e.repath-=DT;
  if(!e.path.length&&e.repath>0){this.waitForRoute(e);return false;}
  if(!e.path.length||e.repath<=0) {
   if(this.pathBudget>0) {
    this.pathBudget--;
    e.path=findPath(this.state.map,this.state.entities,e,target,e.owner,1800,this.alliedOwners(e.owner));
    // A* returns no nodes when already in an interaction tile. Finish crossing
    // that tile instead of losing the last fraction of a route on a refresh.
    if(!e.path.length) {
     const center={x:Math.floor(e.x)+.5,y:Math.floor(e.y)+.5};
     const destination=Math.floor(e.x)===Math.floor(target.x)&&Math.floor(e.y)===Math.floor(target.y)&&this.canStand(e,target.x,target.y)?target:center;
     if(distance(e,destination)>.08&&this.canStand(e,destination.x,destination.y))e.path=[destination];
    }
    e.repath=2+e.id%10*.04;
    if(!e.path.length){this.waitForRoute(e);return false;}
   }else{this.metrics.pathQueue++;if(!e.path.length)return false;}
  }
  let next=e.path[0];if(!next)return false;
  if(distance(e,next)<.18){e.path.shift();next=e.path[0];if(!next)return distance(e,target)<=reach+.7||!this.canStand(e,target.x,target.y);}
  const speed=this.unitStats(e).speed*DT,dist=distance(e,next);
  let dx=(next.x-e.x)/dist*Math.min(speed,dist),dy=(next.y-e.y)/dist*Math.min(speed,dist);
  // A small local repulsion keeps formations fluid without turning each neighbor into an A* obstacle.
  for(const other of this.entitiesNear(e.x,e.y,1))if(other.id!==e.id&&other.kind==='unit') {
   const d=distance(e,other),limit=e.radius+other.radius;
   if(d<limit&&d>.001){const force=(limit-d)*.28;dx+=(e.x-other.x)/d*force;dy+=(e.y-other.y)/d*force;}
  }
  const length=Math.hypot(dx,dy);if(length>speed*1.25){dx*=speed*1.25/length;dy*=speed*1.25/length;}
  let moved=false;
  if(this.canStand(e,e.x+dx,e.y+dy)){e.x+=dx;e.y+=dy;moved=true;}
  else if(this.canStand(e,e.x+dx,e.y)){e.x+=dx;moved=true;}
  else if(this.canStand(e,e.x,e.y+dy)){e.y+=dy;moved=true;}
  if(moved){e.facing=Math.atan2(dy,dx);e.stuck=0;}else {e.stuck+=DT;if(e.stuck>.7){e.path=[];e.repath=0;}}
  return distance(e,target)<=reach;
 }
 private waitForRoute(e:Entity) {
  e.stuck+=DT;
  if(e.stuck>3)this.notice(e,'No route to this task.');
  if(e.stuck>8)this.finishOrder(e);
 }
 private approach(e:Entity,t:Entity,range:number) {
  if(this.edgeDistance(e,t)<=range)return true;
  this.walk(e,t,Math.max(.1,range+t.radius-.35));
  return this.edgeDistance(e,t)<=range;
 }
 private depositBuilding(e:Entity):Entity|undefined {
  if(!e.carryType)return;
  let best:Entity|undefined,bestDistance=Infinity;
  for(const b of this.state.entities)if(b.owner===e.owner&&b.kind==='building'&&b.completed&&b.hp>0&&BUILDINGS[b.type as BuildingType].dropoff?.includes(e.carryType)) {
   const d=distance(e,b);if(d<bestDistance){bestDistance=d;best=b;}
  }
  return best;
 }
 private autoDeposit(e:Entity) {
  const b=this.depositBuilding(e);if(!b){e.task='No drop-off available';this.notice(e,'No compatible drop-off remains. Build a Town Center or storehouse.');return false;}
  e.orders.unshift({type:'deposit',target:b.id,x:b.x,y:b.y});e.path=[];e.repath=0;return true;
 }
 private gather(e:Entity,t:Entity|undefined) {
  const current=e.orders[0]!;
  if(!t||t.hp<=0||t.amount<=0) {
   const resource=t?.resource??current.resource??e.carryType;
   const replacement=this.entitiesNear(e.x,e.y,18).filter(r=>r.amount>0&&r.resource===resource&&(r.kind==='resource'||r.type==='farm'&&r.owner===e.owner&&r.completed)&&this.isVisible(e.owner,r)).sort((a,b)=>distance(e,a)-distance(e,b))[0];
   if(replacement){current.target=replacement.id;current.x=replacement.x;current.y=replacement.y;e.path=[];e.repath=0;return;}
   this.finishOrder(e);if(e.carry>0)this.autoDeposit(e);else this.notice(e,'Resource depleted. Choose a new gathering site.');return;
  }
  if(e.carry>0&&(e.carryType!==t.resource||e.carry>=this.carryCapacity(e))){this.autoDeposit(e);return;}
  e.task=`Gathering ${t.resource}`;
  if(!this.approach(e,t,.85))return;
  const p=this.state.players[e.owner]!,mult=(p.techs.includes('gather')?1.25:1)*(p.civ==='river'&&t.type==='farm'?1.15:1);
  const amount=Math.min(t.amount,this.carryCapacity(e)-e.carry,.85*mult*DT);
  if(amount<=0)return;
  t.amount-=amount;e.carry+=amount;e.carryType=t.resource;e.facing=Math.atan2(t.y-e.y,t.x-e.x);e.work+=DT;
  if(t.amount<.001){t.amount=0;t.hp=0;this.emit('depleted',e.owner,`${t.type==='farm'?'Farm':'Resource'} depleted.`,t.x,t.y,t.id);}
  if(e.carry>=this.carryCapacity(e)-.001)this.autoDeposit(e);
 }
 private carryCapacity(e:Entity) {return 10+(this.state.players[e.owner]!.techs.includes('carry')?5:0);}
 private production(b:Entity) {
  if(!b.completed||!b.queue.length)return;
  const q=b.queue[0]!;q.progress=Math.min(q.time,q.progress+DT);b.task=q.kind==='tech'?`Researching ${TECHS[q.type as TechId].name}`:`Training ${UNITS[q.type as UnitType].name}`;
  if(q.progress+1e-7<q.time)return;
  if(q.kind==='unit') {
   const population=this.population(b.owner);
   if(population.current+q.population>population.cap){b.task='Population blocked';this.notice(b,'Production is waiting for housing. Build another house.');return;}
   const point=this.spawnPoint(b);if(!point){b.task='Exit blocked';this.notice(b,'Production complete, but all exits are blocked.');return;}
   const u=this.createUnit(b.owner,q.type as UnitType,point.x,point.y);this.state.players[b.owner]!.stats.trained++;
   if(b.rally)this.setOrder(u,{type:'move',...b.rally},false);
   this.emit('trained',b.owner,`${UNITS[q.type as UnitType].name} trained.`,u.x,u.y,u.id);
  }else this.completeResearch(b.owner,q.type as TechId,b);
  b.queue.shift();if(!b.queue.length)b.task='Idle';
 }
 private spawnPoint(b:Entity):Point|undefined {
  const radius=b.radius+.8;
  for(let ring=0;ring<3;ring++)for(let i=0;i<24;i++) {
   const angle=(i/24)*Math.PI*2,point={x:b.x+Math.cos(angle)*(radius+ring*.6),y:b.y+Math.sin(angle)*(radius+ring*.6)};
   if(point.x<.5||point.y<.5||point.x>=this.state.map.size-.5||point.y>=this.state.map.size-.5)continue;
   if(this.canStand({...b,kind:'unit',radius:.32},point.x,point.y)&&!this.entitiesNear(point.x,point.y,.5).some(e=>e.kind==='unit'&&distance(e,point)<e.radius+.3))return point;
  }
 }
 private completeResearch(owner:number,tech:TechId,b:Entity) {
  const p=this.state.players[owner]!;if(p.techs.includes(tech))return;
  p.techs.push(tech);
  if(tech.startsWith('age')) {p.age=Number(tech.slice(3));this.emit('age',owner,`Advanced to age ${p.age}.`,b.x,b.y,b.id);}
  if(tech==='health'||tech==='durability')for(const e of this.state.entities)if(e.owner===owner&&(tech==='health'?e.kind==='unit':e.kind==='building')) {
   const ratio=e.hp/e.maxHp;e.maxHp=Math.round(e.maxHp*1.2);e.hp=e.maxHp*ratio;
  }
  this.emit('research',owner,`${TECHS[tech].name} complete.`,b.x,b.y,b.id);
 }
 private attackStats(e:Entity) {
  if(e.kind==='unit'){const def=this.unitStats(e);return {damage:def.damage,range:def.range,cooldown:def.cooldown,bonus:def.bonus,targets:def.targets};}
  const p=this.state.players[e.owner]!,upgrade=p.techs.includes('tower');return {damage:upgrade?11:8,range:upgrade?8:7,cooldown:1.4,bonus:undefined,targets:['unit','building'] as ('unit'|'building')[]};
 }
 private hostile(a:Entity,b:Entity) {return this.isHostile(a.owner,b.owner)&&b.hp>0&&b.kind!=='resource';}
 private acquire(e:Entity,r:number):Entity|undefined {
  if(this.state.settings.peaceful)return;
  const stats=this.attackStats(e);
  let best:Entity|undefined,bestScore=Infinity;
  for(const t of this.entitiesNear(e.x,e.y,r))if(this.hostile(e,t)&&stats.targets.includes(t.kind as 'unit'|'building')&&this.isVisible(e.owner,t)) {
   const score=(t.kind==='unit'?0:16)+(e.x-t.x)**2+(e.y-t.y)**2;
   if(score<bestScore){bestScore=score;best=t;}
  }
  return best;
 }
 private hit(attacker:Entity,target:Entity) {
  if(attacker.cooldown>0||target.hp<=0)return;
  const stats=this.attackStats(attacker);
  if(!stats.targets.includes(target.kind as 'unit'|'building'))return;
  const armor=target.kind==='unit'?this.unitStats(target).armor:target.type==='wall'||target.type==='gate'?3:1;
  const bonus=stats.bonus?.[target.kind==='building'?'building':target.type as UnitType]??0;
  const damage=Math.max(1,stats.damage+bonus-armor);
  attacker.cooldown=stats.cooldown;attacker.facing=Math.atan2(target.y-attacker.y,target.x-attacker.x);attacker.task='Attacking';attacker.work+=1;
  if(stats.range>2) {
   const total=Math.max(.15,distance(attacker,target)/12);
   this.state.projectiles.push({id:this.state.nextId++,owner:attacker.owner,target:target.id,x:attacker.x,y:attacker.y,tx:target.x,ty:target.y,damage,life:total,total,style:attacker.type==='siege'?'stone':'arrow'});
  }else this.damage(target,damage,attacker.owner);
  this.emit('attack',attacker.owner,'Attack',target.x,target.y,attacker.id);
 }
 private damage(target:Entity,amount:number,owner:number) {
  if(target.hp<=0||!this.isHostile(owner,target.owner))return;
  const alert=this.state.tick-target.lastHit>160;target.hp-=amount;target.lastHit=this.state.tick;
  if(alert)this.emit('attacked',target.owner,`${target.kind==='building'?BUILDINGS[target.type as BuildingType].name:UNITS[target.type as UnitType].name} under attack!`,target.x,target.y,target.id);
  if(target.hp<=0) {
   const p=this.state.players[target.owner],killer=this.state.players[owner];
   if(p&&target.kind==='unit')p.stats.lost++;
   if(killer){if(target.kind==='unit')killer.stats.kills++;else if(target.kind==='building')killer.stats.destroyed++;}
   this.emit('death',target.owner,`${target.kind==='building'?'Building destroyed':'Unit lost'}.`,target.x,target.y,target.id);
  }
 }
 private combat(e:Entity,t:Entity|undefined,hold=false) {
  if(!t||!this.hostile(e,t)||!this.isVisible(e.owner,t)) {if(!hold)this.finishOrder(e);return;}
  const stats=this.attackStats(e);
  if(!stats.targets.includes(t.kind as 'unit'|'building')){if(!hold)this.finishOrder(e);return;}
  if(!e.home)e.home={x:e.x,y:e.y};
  const automatic=e.orders[0]?.automatic===true;
  const chaseLimit=automatic?Math.min(this.unitStats(e).sight,8):24;
  if(distance(e,e.home)>chaseLimit||(automatic&&distance(t,e.home)>chaseLimit+stats.range)){if(!hold)this.finishOrder(e);return;}
  if(this.edgeDistance(e,t)<=stats.range+.15){e.path=[];this.hit(e,t);}
  else if(!hold){e.task='Chasing';this.approach(e,t,stats.range);}
 }
 private updateUnit(e:Entity,builders:Map<number,Entity[]>) {
  let order=e.orders[0];
  if(!order) {
   const r=e.type==='villager'?3:Math.min(this.unitStats(e).sight,8);
   const target=this.acquire(e,r);
   if(target){
    e.home={x:e.x,y:e.y};
    e.orders.unshift({type:'attack',target:target.id,x:target.x,y:target.y,automatic:true},{type:'move',x:e.x,y:e.y,automatic:true});
    order=e.orders[0];
   }else {e.task='Idle';return;}
  }
  const t=order.target===undefined?undefined:this.get(order.target);
  if(order.type==='move'||order.type==='attackMove') {
   if(order.type==='attackMove') {
    const target=this.acquire(e,Math.min(this.unitStats(e).sight,8));
    if(target){e.orders.unshift({type:'attack',target:target.id,x:target.x,y:target.y});e.path=[];e.repath=0;e.home={x:e.x,y:e.y};return;}
   }
   e.task=order.type==='move'?'Moving':'Advancing';if(this.walk(e,order,.3))this.finishOrder(e);
  }else if(order.type==='attack')this.combat(e,t);
  else if(order.type==='hold') {e.task='Holding position';const target=this.acquire(e,this.attackStats(e).range);if(target)this.combat(e,target,true);}
  else if(order.type==='gather')this.gather(e,t);
  else if(order.type==='deposit') {
   if(e.carry<=.0001||!e.carryType){e.carry=0;e.carryType=undefined;this.finishOrder(e);return;}
   if(!t||t.owner!==e.owner||!t.completed||!BUILDINGS[t.type as BuildingType]?.dropoff?.includes(e.carryType)) {
    this.finishOrder(e);this.autoDeposit(e);return;
   }
   e.task=`Returning ${e.carryType}`;
   if(this.approach(e,t,.9)) {
    const p=this.state.players[e.owner]!;p.resources[e.carryType]+=e.carry;p.stats.gathered+=e.carry;
    this.emit('deposit',e.owner,`Deposited ${Math.round(e.carry)} ${e.carryType}.`,t.x,t.y,e.id);e.carry=0;e.carryType=undefined;this.finishOrder(e);
   }
  }else if(order.type==='build') {
   if(!t||t.hp<=0||t.completed){this.finishOrder(e);if(t?.type==='farm'&&t.completed)this.setOrder(e,{type:'gather',target:t.id,x:t.x,y:t.y},false);return;}
   e.task='Constructing';if(this.approach(e,t,.9)){let team=builders.get(t.id);if(!team)builders.set(t.id,team=[]);team.push(e);e.facing=Math.atan2(t.y-e.y,t.x-e.x);e.work+=DT;}
  }else if(order.type==='repair') {
   if(!t||t.hp<=0||t.hp>=t.maxHp){this.finishOrder(e);return;}
   e.task='Repairing';if(!this.approach(e,t,.9))return;
   const def=BUILDINGS[t.type as BuildingType],gain=Math.min(12*DT,t.maxHp-t.hp),cost:Partial<Stock>={};
   for(const r of RES)cost[r]=(def.cost[r]??0)*gain/t.maxHp*.5;
   if(this.afford(e.owner,cost)){this.spend(e.owner,cost);t.hp+=gain;e.work+=DT;}else this.notice(e,'Insufficient resources for repairs.');
  }
 }
 /** Snapshot every mutable nested field; unseen memory must never share live arrays. */
 private remember(e:Entity):Entity {
  return {...e,orders:e.orders.map(order=>({...order})),path:e.path.map(point=>({...point})),queue:e.queue.map(item=>({...item,cost:{...item.cost}})),...(e.rally?{rally:{...e.rally}}:{}),...(e.home?{home:{...e.home}}:{})};
 }
 private sameResourceSnapshot(e:Entity,previous:Entity) {
  return e.id===previous.id&&e.owner===previous.owner&&e.kind===previous.kind&&e.type===previous.type&&e.x===previous.x&&e.y===previous.y&&e.prevX===previous.prevX&&e.prevY===previous.prevY&&e.hp===previous.hp&&e.maxHp===previous.maxHp&&e.radius===previous.radius&&e.completed===previous.completed&&e.progress===previous.progress&&e.amount===previous.amount&&e.resource===previous.resource&&e.carry===previous.carry&&e.carryType===previous.carryType&&e.cooldown===previous.cooldown&&e.work===previous.work&&e.task===previous.task&&e.facing===previous.facing&&e.stuck===previous.stuck&&e.repath===previous.repath&&e.lastHit===previous.lastHit&&e.open===previous.open&&!e.home&&!previous.home&&!e.rally&&!previous.rally&&!e.orders.length&&!previous.orders.length&&!e.path.length&&!previous.path.length&&!e.queue.length&&!previous.queue.length;
 }
 private updateFog() {
  const {map,players}=this.state,s=map.size;
  const teamVisibility=new Map<number,number[]>();
  for(const p of players) {
   const team=p.team??p.id,shared=teamVisibility.get(team);
   if(shared) {
    for(let i=0;i<shared.length;i++){p.visible[i]=shared[i]!;if(shared[i])p.explored[i]=1;}
   }else {
    p.visible.fill(0);
    for(const e of this.state.entities)if(this.areAllied(e.owner,p.id)&&e.hp>0) {
    if(e.kind==='building'&&!e.completed)continue;
    const r=e.kind==='unit'?UNITS[e.type as UnitType].sight+(this.state.players[e.owner]!.civ==='steppe'&&e.type==='scout'?2:0):BUILDINGS[e.type as BuildingType].sight;
    const radiusSquared=r*r,minX=Math.max(0,Math.floor(e.x-r)),maxX=Math.min(s-1,Math.ceil(e.x+r));
    const minY=Math.max(0,Math.floor(e.y-r)),maxY=Math.min(s-1,Math.ceil(e.y+r));
    for(let y=minY;y<=maxY;y++) {
     const dy=y+.5-e.y,row=y*s;
     for(let x=minX;x<=maxX;x++)if((x+.5-e.x)**2+dy*dy<=radiusSquared){p.visible[row+x]=1;p.explored[row+x]=1;}
    }
   }
    teamVisibility.set(team,p.visible);
   }
   for(const [id,memory] of Object.entries(p.memory)) {
    if((this.areAllied(memory.owner,p.id)||p.visible[Math.floor(memory.y)*s+Math.floor(memory.x)])&&!this.get(Number(id)))delete p.memory[id];
   }
   for(const e of this.state.entities)if(e.owner!==p.id&&e.kind!=='unit'&&this.isVisible(p.id,e)) {
    const previous=p.memory[e.id];
    // Neutral scenery usually has no changes between fog updates. Retain its
    // independent snapshot rather than allocating hundreds of identical copies.
    if(e.kind==='resource'&&previous&&this.sameResourceSnapshot(e,previous))continue;
    p.memory[e.id]=this.remember(e);
   }
  }
  this.fogDirty=false;
 }
 isVisible(owner:number,e:Entity) {
  if(this.areAllied(e.owner,owner))return true;
  const p=this.state.players[owner],s=this.state.map.size;
  if(!p||e.x<0||e.y<0||e.x>=s||e.y>=s)return false;
  return p.visible[Math.floor(e.y)*s+Math.floor(e.x)]===1;
 }
 private cleanup() {
  if(this.state.entities.some(e=>e.hp<=0)) {
   this.state.entities=this.state.entities.filter(e=>e.hp>0);this.reindex();this.fogDirty=true;
  }
 }
 private checkVictory() {
  for(const p of this.state.players)if(!p.defeated&&!this.state.entities.some(e=>e.owner===p.id&&e.hp>0&&e.kind!=='resource')) {
   p.defeated=true;this.emit('defeated',p.id,`${p.name} has fallen.`);
  }
  if(this.state.players[0]!.defeated){this.state.result='defeat';this.emit('defeat',0,'Your kingdom has fallen.');}
  else if(!this.state.settings.peaceful&&this.state.players.some(p=>this.isHostile(0,p.id))&&this.state.players.filter(p=>this.isHostile(0,p.id)).every(p=>p.defeated)){this.state.result='victory';this.emit('victory',0,'All rival kingdoms have fallen.');}
 }
 step(ticks=1) {
  if(!Number.isFinite(ticks)||ticks<0)return;
  const start=performance.now();
  for(let i=0;i<Math.min(10000,Math.floor(ticks));i++) {
   if(this.state.paused||this.state.result!=='playing')break;
   this.state.tick++;this.pathBudget=6;this.metrics.pathQueue=0;this.reindex();
   if(this.state.tick%8===0)this.updateFog();
   const aiStart=performance.now();updateAI(this);this.metrics.aiMs=performance.now()-aiStart;
   const builders=new Map<number,Entity[]>();
   const entities=[...this.state.entities];
   for(const e of entities) {
    if(e.hp<=0||e.kind==='resource')continue;
    e.prevX=e.x;e.prevY=e.y;e.cooldown=Math.max(0,e.cooldown-DT);
    if(e.kind==='unit')this.updateUnit(e,builders);
    else if(e.completed){this.production(e);if(e.type==='tower'&&!this.state.settings.peaceful){const target=this.acquire(e,this.attackStats(e).range);if(target)this.hit(e,target);}}
   }
   for(const [id,team] of builders) {
    const b=this.get(id);if(!b||b.hp<=0||b.completed)continue;
    const def=BUILDINGS[b.type as BuildingType],gain=DT*(1+Math.sqrt(Math.max(0,team.length-1))*.65)/def.time;
    const before=b.progress;b.progress=Math.min(1,b.progress+gain);b.hp=Math.min(b.maxHp,b.hp+(b.progress-before)*b.maxHp*.95);
    if(b.progress>=1){b.completed=true;this.state.players[b.owner]!.stats.built++;this.emit('build',b.owner,`${def.name} complete.`,b.x,b.y,b.id);this.fogDirty=true;}
   }
   for(const projectile of this.state.projectiles) {
    projectile.life-=DT;
    if(projectile.life<=0){const target=this.get(projectile.target);if(target&&target.hp>0)this.damage(target,projectile.damage,projectile.owner);}
   }
   this.state.projectiles=this.state.projectiles.filter(p=>p.life>0);
   this.cleanup();this.checkVictory();
   if(this.state.tick%200===0)for(const [key,tick]of this.notices)if(this.state.tick-tick>1200)this.notices.delete(key);
  }
  this.metrics.simulationMs=performance.now()-start;
 }
 serialize() {return encodeSave(this.state);}
 static load(json:string) {const state=decodeSave(json);return new Engine(state.settings,state);}
}
