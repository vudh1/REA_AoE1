import {describe,it,expect} from 'vitest';
import {Engine} from '../src/game/engine';
import {DEFAULT_SETTINGS,type Command} from '../src/game/types';
import {generateMap,validateMap} from '../src/game/map';
import {isWalkable,findPath} from '../src/game/pathfinding';

function match() {
 const engine=new Engine({...DEFAULT_SETTINGS,seed:'ALLIED-TEST',size:'small',opponents:1,allies:1});
 engine.state.map.tiles.fill(0);engine.state.entities=[];engine.state.projectiles=[];
 for(const player of engine.state.players){delete player.ai;player.visible.fill(1);player.explored.fill(1);}
 engine.createBuilding(0,'towncenter',15.5,15.5);
 engine.createBuilding(1,'towncenter',80.5,80.5);
 engine.createBuilding(2,'towncenter',45.5,45.5);
 engine.step();return engine;
}

describe('team skirmishes',()=>{
 it('starts independent enemies and a complete allied NPC village',()=>{
  const engine=new Engine({...DEFAULT_SETTINGS,opponents:3,allies:1,size:'small'});
  expect(engine.state.players.map(p=>p.team)).toEqual([0,1,2,3,0]);
  expect(engine.state.map.starts).toHaveLength(5);
  for(const player of engine.state.players) {
   const own=engine.state.entities.filter(e=>e.owner===player.id);
   expect(own.filter(e=>e.type==='towncenter')).toHaveLength(1);
   expect(own.filter(e=>e.type==='villager')).toHaveLength(5);
   expect(own.filter(e=>e.type==='scout')).toHaveLength(1);
   if(player.id)expect(player.ai).toBeDefined();
   expect(player.resources).not.toBe(engine.state.players[(player.id+1)%5]!.resources);
  }
  expect(engine.areAllied(0,4)).toBe(true);expect(engine.isHostile(1,2)).toBe(true);
  expect(engine.areAllied(-1,0)).toBe(false);expect(engine.isHostile(-1,0)).toBe(false);
 });
 it('keeps five village colors distinct with a neutral custom human color',()=>{
  const engine=new Engine({...DEFAULT_SETTINGS,opponents:3,allies:1,color:'#8c8c8c'});
  expect(new Set(engine.state.players.map(player=>player.color)).size).toBe(5);
 });
 it.each(['small','medium','large'] as const)('generates connected five-player %s maps with resources and clear starts',size=>{
  const settings={...DEFAULT_SETTINGS,size,opponents:3,allies:1,seed:'FIVE-VILLAGES'};
  const generated=generateMap(settings);
  expect(generateMap(settings)).toEqual(generated);expect(validateMap(generated.map)).toBe(true);
  for(const start of generated.map.starts) {
   for(const kind of ['food','wood','gold','stone'])expect(generated.resources.some(r=>r.resource===kind&&Math.hypot(r.x-start.x,r.y-start.y)<17)).toBe(true);
   expect(generated.resources.some(r=>Math.hypot(r.x-start.x,r.y-start.y)<6.5)).toBe(false);
   for(const other of generated.map.starts)if(other!==start)expect(Math.hypot(start.x-other.x,start.y-other.y)).toBeGreaterThan(30);
  }
 });
 it('loads older saves without ally or team fields as independent kingdoms',()=>{
  const engine=new Engine({...DEFAULT_SETTINGS});
  const old=JSON.parse(engine.serialize());delete old.settings.allies;
  for(const player of old.players)delete player.team;
  const loaded=Engine.load(JSON.stringify(old));
  expect(loaded.state.players).toHaveLength(2);expect(loaded.isHostile(0,1)).toBe(true);expect(loaded.areAllied(0,0)).toBe(true);
 });
 it('rejects invalid ally counts and out-of-range saved teams',()=>{
  expect(()=>new Engine({...DEFAULT_SETTINGS,allies:2})).toThrow(/ally/);
  const state=JSON.parse(match().serialize());state.players[2].team=99;
  expect(()=>Engine.load(JSON.stringify(state))).toThrow(/team/);
  state.players[2].team=0;state.settings.allies=0;
  expect(()=>Engine.load(JSON.stringify(state))).toThrow(/players/);
 });
 it('rejects a malformed unit order before it can strand a worker',()=>{
  const engine=match(),worker=engine.createUnit(0,'villager',20.5,20.5);
  engine.command(0,{type:'order',ids:[worker.id],order:{type:'move',x:25.5,y:25.5}});
  const orders=JSON.stringify(worker.orders);
  const bad={type:'order',ids:[worker.id],order:{type:'towncenter',x:15.5,y:15.5}} as unknown as Command;
  expect(engine.command(0,bad)).toEqual({ok:false,reason:'Unknown unit order.'});expect(JSON.stringify(worker.orders)).toBe(orders);
 });
 it('shares allied sight without granting it to enemies',()=>{
  const engine=match(),enemy=engine.createUnit(1,'scout',48.5,45.5);engine.step(8);
  expect(engine.isVisible(0,enemy)).toBe(true);expect(engine.isVisible(2,enemy)).toBe(true);
  expect(engine.state.players[0]!.visible).toEqual(engine.state.players[2]!.visible);expect(engine.state.players[0]!.visible).not.toBe(engine.state.players[2]!.visible);
  const own=engine.state.entities.find(e=>e.owner===0)!;
  expect(engine.isVisible(1,own)).toBe(false);
  expect(engine.state.players[0]!.visible[45*engine.state.map.size+45]).toBe(1);
 });
 it('rejects allied commands and attacks, ignores allies in acquisition and prevents projectile friendly fire',()=>{
  const engine=match(),own=engine.createUnit(0,'archer',40.5,40.5),ally=engine.createUnit(2,'infantry',42.5,40.5);
  expect(engine.command(0,{type:'order',ids:[own.id],order:{type:'attack',target:ally.id,x:ally.x,y:ally.y}}).ok).toBe(false);
  expect(engine.command(0,{type:'order',ids:[ally.id],order:{type:'move',x:50,y:50}}).ok).toBe(false);
  const hp=ally.hp;
  engine.state.projectiles.push({id:engine.state.nextId++,owner:0,target:ally.id,x:own.x,y:own.y,tx:ally.x,ty:ally.y,damage:100,life:.05,total:.1,style:'arrow'});
  engine.step(100);expect(ally.hp).toBe(hp);expect(own.orders).toHaveLength(0);
 });
 it('allows allies through a closed gate in pathfinding and continuous movement',()=>{
  const engine=match(),gate=engine.createBuilding(2,'gate',40,40),unit=engine.createUnit(0,'scout',37.5,40.5);gate.open=false;
  expect(isWalkable(engine.state.map,engine.state.entities,39.5,39.5,0)).toBe(false);
  expect(isWalkable(engine.state.map,engine.state.entities,39.5,39.5,0,[0,2])).toBe(true);
  expect(findPath(engine.state.map,engine.state.entities,unit,{x:43.5,y:40.5},0,1800,[0,2]).length).toBeGreaterThan(0);
  engine.command(0,{type:'order',ids:[unit.id],order:{type:'move',x:43.5,y:40.5}});engine.step(100);
  expect(unit.x).toBeGreaterThan(42);
  unit.x=40;unit.y=40;gate.open=true;
  expect(engine.command(2,{type:'gate',id:gate.id}).ok).toBe(true);
 });
 it('wins when enemies fall while an allied village remains alive',()=>{
  const engine=match();for(const entity of engine.state.entities)if(entity.owner===1)entity.hp=0;
  engine.step();expect(engine.state.result).toBe('victory');expect(engine.state.players[2]!.defeated).toBe(false);
 });
 it('saves teams and automatic guard returns, then returns defenders home after a threat leaves',()=>{
  const engine=match(),guard=engine.createUnit(0,'infantry',35.5,35.5),enemy=engine.createUnit(1,'scout',42,35.5);
  engine.state.players[0]!.visible.fill(1);engine.step(35);
  expect(guard.x).toBeGreaterThan(36);expect(guard.orders[0]!.automatic).toBe(true);
  expect(guard.orders[1]).toMatchObject({type:'move',x:35.5,y:35.5,automatic:true});
  const restored=Engine.load(engine.serialize());
  expect(restored.areAllied(0,2)).toBe(true);expect(restored.get(guard.id)!.orders).toEqual(guard.orders);
  for(const e of [engine,restored]){const target=e.get(enemy.id)!;target.x=65.5;target.y=65.5;e.step(220);}
  expect(Math.hypot(guard.x-35.5,guard.y-35.5)).toBeLessThan(1);
  expect(restored.serialize()).toBe(engine.serialize());
 });
});
