import {describe,it,expect} from 'vitest';
import {Engine} from '../src/game/engine';
import {DEFAULT_SETTINGS} from '../src/game/types';
import type {Entity} from '../src/game/types';
import {BUILDINGS,UNITS} from '../src/game/data';

function scenario() {
 const e=new Engine({...DEFAULT_SETTINGS,seed:'ENGINE-TEST',size:'small',peaceful:true});
 e.state.map.tiles.fill(0);e.state.entities=[];e.state.projectiles=[];
 for(const p of e.state.players){delete p.ai;p.resources={food:3000,wood:3000,gold:3000,stone:3000};p.explored.fill(1);p.visible.fill(1);}
 const tc=e.createBuilding(0,'towncenter',20.5,20.5);
 const enemy=e.createBuilding(1,'towncenter',80.5,80.5);
 const villager=e.createUnit(0,'villager',23.5,24.5);
 e.step();return {e,tc,enemy,villager};
}
function resource(e:Engine,x:number,y:number,amount=50):Entity {
 const r=e.createUnit(0,'villager',x,y);
 Object.assign(r,{kind:'resource',owner:-1,type:'tree',resource:'wood',amount,hp:1,maxHp:1,radius:.4});
 return r;
}

describe('authoritative economy and construction',()=>{
 it('refuses unseen footprints consistently as hidden resources change',()=>{
  const {e}=scenario(),tree=resource(e,40.5,40.5,50);
  e.state.players[0]!.visible.fill(0);
  const before=e.canPlace(0,'house',40,40);
  tree.amount=0;tree.hp=0;
  const after=e.canPlace(0,'house',40,40);
  expect(before.ok).toBe(false);expect(before.reason).toContain('sight');expect(after).toEqual(before);
 });
 it('requires physical gathering/carry/deposit and preserves cargo on task changes',()=>{
  const {e,tc,villager}=scenario(),tree=resource(e,24.5,26.5,12);
  expect(e.command(0,{type:'order',ids:[villager.id],order:{type:'gather',target:tree.id,x:tree.x,y:tree.y}}).ok).toBe(true);
  const wood=e.state.players[0]!.resources.wood;
  e.step(130);
  expect(villager.carry).toBeGreaterThan(0);expect(e.state.players[0]!.resources.wood).toBe(wood);
  const cargo=villager.carry;
  e.command(0,{type:'order',ids:[villager.id],order:{type:'move',x:27.5,y:26.5}});e.step(40);
  expect(villager.carry).toBe(cargo);
  e.command(0,{type:'order',ids:[villager.id],order:{type:'deposit',target:tc.id,x:tc.x,y:tc.y}});e.step(200);
  expect(e.state.players[0]!.resources.wood).toBeCloseTo(wood+cargo);expect(villager.carry).toBe(0);
  e.command(0,{type:'order',ids:[villager.id],order:{type:'gather',target:tree.id,x:tree.x,y:tree.y}});e.step(800);
  expect(e.get(tree.id)).toBeUndefined();expect(e.state.players[0]!.resources.wood).toBeCloseTo(wood+12);
 });
 it('seeks another compatible resource after an exact-capacity depletion and deposit',()=>{
  const {e,villager}=scenario(),first=resource(e,24.5,26.5,10),second=resource(e,27.5,26.5,5);
  const before=e.state.players[0]!.resources.wood;
  e.command(0,{type:'order',ids:[villager.id],order:{type:'gather',target:first.id,x:first.x,y:first.y}});e.step(1600);
  expect(e.get(first.id)).toBeUndefined();expect(e.get(second.id)).toBeUndefined();
  expect(e.state.players[0]!.resources.wood).toBeCloseTo(before+15);
 });
 it('deducts a foundation once, rejects overlap, and refunds exactly 75% on cancellation',()=>{
  const {e,villager}=scenario();const wood=e.state.players[0]!.resources.wood;
  const command={type:'build' as const,building:'house' as const,x:28,y:22,builders:[villager.id]};
  const result=e.command(0,command);expect(result.ok).toBe(true);
  expect(e.state.players[0]!.resources.wood).toBe(wood-BUILDINGS.house.cost.wood!);
  expect(e.command(0,command).ok).toBe(false);
  expect(e.command(0,{type:'cancel',id:result.id!}).ok).toBe(true);
  expect(e.state.players[0]!.resources.wood).toBe(wood-BUILDINGS.house.cost.wood!*.25);
  expect(e.command(0,{type:'cancel',id:result.id!}).ok).toBe(false);
 });
 it('multiple physical builders accelerate construction with diminishing returns',()=>{
  const build=(workers:number)=>{
   const {e,villager}=scenario();villager.x=28.5;villager.y=23.5;
   const ids=[villager.id];if(workers===2)ids.push(e.createUnit(0,'villager',28.5,22.5).id);
   const result=e.command(0,{type:'build',building:'house',x:30,y:22,builders:ids});expect(result.ok).toBe(true);
   e.step(180);return e.get(result.id!)!.progress;
 };
  const one=build(1),two=build(2);expect(one).toBeGreaterThan(.2);expect(two).toBeGreaterThan(one*1.2);expect(two).toBeLessThan(one*2);
 });
 it('validates unexplored/water/unit footprints and spends for repairs',()=>{
  const {e,villager,tc}=scenario();e.state.players[0]!.explored.fill(0);
  expect(e.canPlace(0,'house',30,30).reason).toContain('Explore');
  e.state.players[0]!.explored.fill(1);e.state.map.tiles[30*e.state.map.size+30]=2;
  expect(e.canPlace(0,'house',30,30).ok).toBe(false);
  expect(e.canPlace(0,'house',villager.x,villager.y).ok).toBe(false);
  tc.hp-=40;const wood=e.state.players[0]!.resources.wood;
  e.command(0,{type:'order',ids:[villager.id],order:{type:'repair',target:tc.id,x:tc.x,y:tc.y}});e.step(160);
  expect(tc.hp).toBe(tc.maxHp);expect(e.state.players[0]!.resources.wood).toBeLessThan(wood);
 });
});

describe('production and progression',()=>{
 it('reserves population and refunds a canceled entry only once',()=>{
  const {e,tc}=scenario();
  for(let i=0;i<9;i++)expect(e.command(0,{type:'train',ids:[tc.id],unit:'villager'}).ok).toBe(true);
  expect(e.population(0)).toEqual({current:1,reserved:9,cap:10});
  expect(e.command(0,{type:'train',ids:[tc.id],unit:'villager'}).reason).toContain('Population');
  const food=e.state.players[0]!.resources.food;
  expect(e.command(0,{type:'cancel',id:tc.id,index:8}).ok).toBe(true);
  expect(e.state.players[0]!.resources.food).toBe(food+50);
  expect(e.command(0,{type:'cancel',id:tc.id,index:8}).ok).toBe(false);
  e.step(410);expect(e.population(0).current).toBe(2);expect(e.population(0).reserved).toBe(7);
 });
 it('pauses a reserved unit when housing is destroyed before completion',()=>{
  const {e,tc}=scenario();
  const house=e.createBuilding(0,'house',30,30);
  for(let i=0;i<8;i++)e.createUnit(0,'villager',35.5+i,35.5);
  for(let i=0;i<3;i++)expect(e.command(0,{type:'train',ids:[tc.id],unit:'villager'}).ok).toBe(true);
  house.hp=0;e.step(1210);
  expect(e.population(0)).toEqual({current:10,reserved:2,cap:10});expect(tc.task).toBe('Population blocked');
  e.createBuilding(0,'house',30,30);e.step(2);expect(e.population(0).current).toBe(11);expect(e.population(0).reserved).toBe(1);
 });
 it('waits safely with blocked exits without dropping the reservation',()=>{
  const {e,tc,villager}=scenario();villager.x=35.5;villager.y=35.5;
  for(let y=14;y<=27;y++)for(let x=14;x<=27;x++)e.state.map.tiles[y*e.state.map.size+x]=2;
  expect(e.command(0,{type:'train',ids:[tc.id],unit:'villager'}).ok).toBe(true);e.step(420);
  expect(tc.queue[0]!.progress).toBe(UNITS.villager.time);expect(tc.task).toBe('Exit blocked');
  expect(e.population(0).reserved).toBe(1);
  e.state.map.tiles.fill(0);e.step(2);expect(tc.queue).toHaveLength(0);expect(e.population(0).current).toBe(2);
 });
 it('enforces age prerequisites and prevents duplicate queued research',()=>{
  const {e,tc}=scenario();expect(e.command(0,{type:'research',id:tc.id,tech:'age2'}).ok).toBe(false);
  e.createBuilding(0,'granary',30.5,20.5);e.createBuilding(0,'barracks',35.5,20.5);
  expect(e.command(0,{type:'research',id:tc.id,tech:'age2'}).ok).toBe(true);
  expect(e.command(0,{type:'research',id:tc.id,tech:'age2'}).ok).toBe(false);e.step(1305);
  expect(e.state.players[0]!.age).toBe(2);expect(e.state.players[0]!.techs).toEqual(['age2']);
 });
 it('applies upgrades once and preserves health and reservations across save/load',()=>{
  const {e,villager}=scenario();e.state.players[0]!.age=3;
  const academy=e.createBuilding(0,'academy',30.5,20.5),before=villager.maxHp;
  expect(e.command(0,{type:'research',id:academy.id,tech:'health'}).ok).toBe(true);e.step(905);
  expect(villager.maxHp).toBe(Math.round(before*1.2));
  const loaded=Engine.load(e.serialize());loaded.step(20);
  expect(loaded.get(villager.id)!.maxHp).toBe(villager.maxHp);
  expect(loaded.command(0,{type:'research',id:academy.id,tech:'health'}).ok).toBe(false);
 });
});

describe('combat, information and match rules',()=>{
 it('refuses to close a gate around a foreign unit',()=>{
  const {e}=scenario(),gate=e.createBuilding(0,'gate',40,40),visitor=e.createUnit(1,'scout',40,40);gate.open=true;
  const blocked=e.command(0,{type:'gate',id:gate.id});expect(blocked.ok).toBe(false);expect(blocked.reason).toContain('inside the gate');expect(gate.open).toBe(true);
  visitor.x=45;visitor.y=45;
  expect(e.command(0,{type:'gate',id:gate.id}).ok).toBe(true);expect(gate.open).toBe(false);
 });
 it('uses real cooldown damage and spearman counter bonuses',()=>{
  const {e}=scenario();e.state.settings.peaceful=false;
  const spear=e.createUnit(0,'spearman',40.5,40.5),cavalry=e.createUnit(1,'cavalry',41.5,40.5);
  e.state.players[0]!.visible.fill(1);e.state.players[1]!.visible.fill(1);
  expect(e.command(0,{type:'order',ids:[spear.id],order:{type:'attack',target:cavalry.id,x:cavalry.x,y:cavalry.y}}).ok).toBe(true);
  const before=cavalry.hp;e.step();expect(before-cavalry.hp).toBe(20);
  const after=cavalry.hp;e.step(10);expect(cavalry.hp).toBe(after);e.step(20);expect(cavalry.hp).toBeLessThan(after);
 });
 it('foundations provide no vision until construction is completed',()=>{
  const {e}=scenario(),foundation=e.createBuilding(0,'tower',60,60,false),player=e.state.players[0]!;
  player.visible.fill(0);player.explored.fill(0);
  const cell=60*e.state.map.size+60;
  e.step(8);expect(player.visible[cell]).toBe(0);expect(player.explored[cell]).toBe(0);
  foundation.completed=true;foundation.progress=1;foundation.hp=foundation.maxHp;
  e.step(8);expect(player.visible[cell]).toBe(1);expect(player.explored[cell]).toBe(1);
 });
 it('does not acquire hidden enemies or update last-seen resources',()=>{
  const {e,villager}=scenario(),tree=resource(e,25.5,25.5,80);e.step(8);
  expect(e.state.players[0]!.memory[tree.id]!.amount).toBe(80);
  villager.x=60.5;villager.y=20.5;e.state.entities.find(x=>x.owner===0&&x.type==='towncenter')!.hp=0;e.step(8);
  tree.amount=20;e.step(8);expect(e.state.players[0]!.memory[tree.id]!.amount).toBe(80);
  const hostile=e.createUnit(1,'infantry',28.5,25.5);
  expect(e.command(0,{type:'order',ids:[villager.id],order:{type:'attack',target:hostile.id,x:hostile.x,y:hostile.y}}).ok).toBe(false);
 });
 it('stop clears queued orders and blocked movement finishes at a reachable perimeter',()=>{
  const {e,tc,villager}=scenario();
  e.command(0,{type:'order',ids:[villager.id],order:{type:'move',x:tc.x,y:tc.y}});e.step(180);
  expect(villager.orders).toHaveLength(0);expect(Math.abs(villager.y-tc.y)).toBeGreaterThan(tc.radius);
  e.command(0,{type:'order',ids:[villager.id],order:{type:'move',x:40,y:40}});
  e.command(0,{type:'order',ids:[villager.id],order:{type:'move',x:50,y:50},queue:true});
  e.command(0,{type:'order',ids:[villager.id],order:{type:'stop',x:0,y:0}});
  expect(villager.orders).toHaveLength(0);expect(villager.path).toHaveLength(0);expect(villager.task).toBe('Idle');
 });
 it('pause freezes every simulation subsystem',()=>{
  const {e,tc,villager}=scenario();e.command(0,{type:'train',ids:[tc.id],unit:'villager'});
  e.command(0,{type:'order',ids:[villager.id],order:{type:'move',x:40,y:40}});e.state.paused=true;
  const before=e.serialize();e.step(1000);expect(e.serialize()).toBe(before);
 });
 it('conquest requires every unit and unfinished building, and resignation is real defeat',()=>{
  const {e,enemy}=scenario();e.state.settings.peaceful=false;
  const last=e.createBuilding(1,'house',70,70,false);enemy.hp=0;e.step();expect(e.state.result).toBe('playing');
  last.hp=0;e.step();expect(e.state.result).toBe('victory');
  const second=scenario().e;second.command(0,{type:'resign'});expect(second.state.result).toBe('defeat');
 });
 it('finishes ranged projectiles once and dead targets cannot act',()=>{
  const {e}=scenario();e.state.settings.peaceful=false;
  const archer=e.createUnit(0,'archer',40.5,40.5),target=e.createUnit(1,'infantry',44.5,40.5);target.hp=1;
  e.state.players[0]!.visible.fill(1);e.command(0,{type:'order',ids:[archer.id],order:{type:'attack',target:target.id,x:target.x,y:target.y}});
  e.step();expect(e.state.projectiles).toHaveLength(1);e.step(20);expect(e.get(target.id)).toBeUndefined();
  const kills=e.state.players[0]!.stats.kills;e.step(100);expect(e.state.players[0]!.stats.kills).toBe(kills);
 });
});
