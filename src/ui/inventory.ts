import {AGE_NAMES, BUILDINGS, CIVS, TECHS, UNITS} from '../game/data';
import type {Engine} from '../game/engine';
import type {BuildingType, Entity, Player, Resource, Stock, TechId, UnitType} from '../game/types';
import {art} from './art';

const RESOURCES: Resource[] = ['food', 'wood', 'gold', 'stone'];
const resourceNames: Record<Resource, string> = {food: 'Food', wood: 'Wood', gold: 'Gold', stone: 'Stone'};
const sources: Record<Resource, string> = {food: 'Berry patches, huntable deer and finite farms.', wood: 'Trees in the surrounding forests.', gold: 'Finite gold deposits.', stone: 'Finite stone deposits.'};
const roles: Record<Resource, string> = {food: 'Sustains villagers and armies, age advancement and research.', wood: 'Builds your settlement, farms, archers and siege engines.', gold: 'Funds advanced soldiers, siege engines and technologies.', stone: 'Builds Town Centers, defensive walls, gates and watch towers.'};
type Availability = {kind: 'available' | 'locked' | 'completed' | 'queued' | 'reference'; text: string};

function escape(value: unknown): string {
  return String(value).replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));
}
function ageName(age: number): string {return AGE_NAMES[age - 1] ?? `Age ${age}`;}
function stats(entries: [string, string | number][]): string {
  return `<dl class="inventory-stats">${entries.map(([name, value]) => `<div><dt>${escape(name)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
}
function costHTML(cost: Partial<Stock>): string {
  return `<div class="inventory-cost" aria-label="Cost">${RESOURCES.filter(resource => (cost[resource] ?? 0) > 0).map(resource => `<span class="inventory-cost-item">${art(resource, 'inventory-cost-art')}<b>${cost[resource]}</b><span>${resourceNames[resource]}</span></span>`).join('')}</div>`;
}
function statusHTML(status: Availability): string {return `<p class="inventory-status is-${status.kind}">${escape(status.text)}</p>`;}
function requirements(age: number, names: string[]): string {
  return `<p class="inventory-requirements"><b>Requires:</b> ${escape([ageName(age), ...names].join(' · '))}</p>`;
}
function card(key: string, kind: string, name: string, description: string, body: string, status: Availability, artKey = key): string {
  return `<article class="inventory-card" data-inventory-kind="${escape(kind)}" data-inventory-key="${escape(key)}" data-availability="${status.kind}"><div class="inventory-portrait">${art(artKey, 'inventory-art')}</div><div class="inventory-details"><h4>${escape(name)}</h4><p class="inventory-description">${escape(description)}</p>${body}${statusHTML(status)}</div></article>`;
}
function section(key: string, title: string, description: string, cards: string[]): string {
  return `<section class="inventory-section" id="inventory-${key}" data-inventory-section="${key}" aria-labelledby="inventory-${key}-heading"><div class="inventory-section-heading"><h3 id="inventory-${key}-heading">${escape(title)}</h3><p>${escape(description)}</p></div><div class="inventory-grid">${cards.join('')}</div></section>`;
}
function ownBuildings(engine: Engine, player: Player): Entity[] {
  return engine.state.entities.filter(entity => entity.owner === player.id && entity.kind === 'building' && entity.hp > 0);
}
function missingCost(player: Player, cost: Partial<Stock>): string | undefined {
  const missing = RESOURCES.filter(resource => player.resources[resource] + 1e-7 < (cost[resource] ?? 0));
  return missing.length ? `Needs ${missing.map(resource => `${Math.ceil((cost[resource] ?? 0) - player.resources[resource])} ${resource}`).join(', ')}.` : undefined;
}
function matchBlocker(engine: Engine, player: Player): Availability | undefined {
  return player.defeated || engine.state.result !== 'playing' ? {kind: 'locked', text: 'This match has ended.'} : undefined;
}
function unitAvailability(engine: Engine | undefined, type: UnitType): Availability {
  if (!engine) return {kind: 'reference', text: 'Available in skirmishes when its requirements are met.'};
  const player = engine.state.players[0]!, def = UNITS[type];
  const ended = matchBlocker(engine, player); if (ended) return ended;
  if (player.age < def.age) return {kind: 'locked', text: `Requires the ${ageName(def.age)}.`};
  const producers = ownBuildings(engine, player).filter(entity => entity.completed && BUILDINGS[entity.type as BuildingType].produces?.includes(type));
  if (!producers.length) return {kind: 'locked', text: `Build a completed ${BUILDINGS[def.building].name}.`};
  if (producers.every(entity => entity.queue.length >= 12)) return {kind: 'locked', text: 'All compatible production queues are full.'};
  const population = engine.population(player.id);
  if (population.current + population.reserved + def.population > population.cap) return {kind: 'locked', text: 'Population is reserved or full. Build housing, up to the match limit.'};
  const missing = missingCost(player, def.cost); if (missing) return {kind: 'locked', text: missing};
  return {kind: 'available', text: `Ready to queue at a ${BUILDINGS[def.building].name}.`};
}
function buildingAvailability(engine: Engine | undefined, type: BuildingType): Availability {
  if (!engine) return {kind: 'reference', text: 'Select villagers during a match to place a foundation.'};
  const player = engine.state.players[0]!, def = BUILDINGS[type];
  const ended = matchBlocker(engine, player); if (ended) return ended;
  if (player.age < def.age) return {kind: 'locked', text: `Requires the ${ageName(def.age)}.`};
  if (def.requires && !ownBuildings(engine, player).some(entity => entity.completed && entity.type === def.requires)) return {kind: 'locked', text: `Requires a completed ${BUILDINGS[def.requires].name}.`};
  const missing = missingCost(player, def.cost); if (missing) return {kind: 'locked', text: missing};
  if (!engine.state.entities.some(entity => entity.owner === player.id && entity.type === 'villager' && entity.hp > 0)) return {kind: 'locked', text: 'Requires a living villager.'};
  return {kind: 'available', text: 'Ready to place with villagers on visible, unoccupied land.'};
}
function techAvailability(engine: Engine | undefined, type: TechId): Availability {
  if (!engine) return {kind: 'reference', text: 'Research once per civilization when its requirements are met.'};
  const player = engine.state.players[0]!, def = TECHS[type], buildings = ownBuildings(engine, player);
  if (player.techs.includes(type) || type.startsWith('age') && player.age >= Number(type.slice(3))) return {kind: 'completed', text: 'Already researched.'};
  const queued = buildings.flatMap(building => building.queue).find(item => item.kind === 'tech' && item.type === type);
  if (queued) return {kind: 'queued', text: `Queued research · ${Math.floor(queued.progress)} / ${queued.time} seconds.`};
  const ended = matchBlocker(engine, player); if (ended) return ended;
  if (player.age < def.age) return {kind: 'locked', text: `Requires the ${ageName(def.age)}.`};
  if (type.startsWith('age') && player.age !== Number(type.slice(3)) - 1) return {kind: 'locked', text: 'Advance one age at a time.'};
  const missingBuilding = def.requires?.find(type => !buildings.some(building => building.completed && building.type === type));
  if (missingBuilding) return {kind: 'locked', text: `Requires a completed ${BUILDINGS[missingBuilding].name}.`};
  const labs = buildings.filter(building => building.completed && building.type === def.building);
  if (!labs.length) return {kind: 'locked', text: `Requires a completed ${BUILDINGS[def.building].name}.`};
  if (labs.every(building => building.queue.length >= 12)) return {kind: 'locked', text: 'All compatible research queues are full.'};
  const missing = missingCost(player, def.cost); if (missing) return {kind: 'locked', text: missing};
  return {kind: 'available', text: `Ready to research at a ${BUILDINGS[def.building].name}.`};
}

/** An illustrated reference, with current human-player availability when a match is supplied. */
export function inventoryHTML(engine?: Engine): string {
  const player = engine?.state.players[0];
  const resourceCards = RESOURCES.map(resource => {
    const dropoffs = Object.values(BUILDINGS).filter(building => building.dropoff?.includes(resource)).map(building => building.name);
    const stock = player ? stats([['In your stockpile', Math.floor(player.resources[resource])]]) : '';
    return card(resource, 'resource', resourceNames[resource], roles[resource], `${stock}<p><b>Sources:</b> ${escape(sources[resource])}</p><p><b>Deposit at:</b> ${escape(dropoffs.join(', '))}</p>`, {kind: 'reference', text: 'Villagers physically gather, carry and deposit. Sources are finite.'});
  });
  const unitCards = (Object.entries(UNITS) as [UnitType, typeof UNITS[UnitType]][]).map(([type, def]) => {
    const bonus = Object.entries(def.bonus ?? {}).map(([target, amount]) => `+${amount} against ${target === 'building' ? 'buildings' : UNITS[target as UnitType].name}`).join('; ');
    const body = `${costHTML(def.cost)}${stats([['Health', def.hp], ['Damage', def.damage], ['Armor', def.armor], ['Range', `${def.range} tiles`], ['Move speed', `${def.speed} tiles/s`], ['Sight', `${def.sight} tiles`], ['Attack interval', `${def.cooldown}s`], ['Train time', `${def.time}s`], ['Population', def.population]])}${requirements(def.age, [BUILDINGS[def.building].name])}<p><b>Targets:</b> ${escape(def.targets.join(', '))}.</p>${bonus ? `<p class="inventory-bonus"><b>Counter bonus:</b> ${escape(bonus)}.</p>` : ''}`;
    return card(type, 'unit', def.name, def.description, body, unitAvailability(engine, type));
  });
  const buildingCards = (Object.entries(BUILDINGS) as [BuildingType, typeof BUILDINGS[BuildingType]][]).map(([type, def]) => {
    const facts: [string, string | number][] = [['Health', def.hp], ['Footprint', `${def.size} × ${def.size} tiles`], ['Build time', `${def.time}s`], ['Sight', `${def.sight} tiles`]];
    if (def.population) facts.push(['Population capacity', `+${def.population}`]);
    const body = `${costHTML(def.cost)}${stats(facts)}${requirements(def.age, def.requires ? [BUILDINGS[def.requires].name] : [])}${def.produces?.length ? `<p><b>Produces:</b> ${escape(def.produces.map(unit => UNITS[unit].name).join(', '))}.</p>` : ''}${def.dropoff?.length ? `<p><b>Accepts:</b> ${escape(def.dropoff.map(resource => resourceNames[resource]).join(', '))}.</p>` : ''}`;
    return card(type, 'building', def.name, def.description, body, buildingAvailability(engine, type));
  });
  const techCards = (Object.entries(TECHS) as [TechId, typeof TECHS[TechId]][]).map(([type, def]) => {
    const key = type.startsWith('age') ? 'age' : ['gather', 'carry'].includes(type) ? type : `tech-${type}`;
    const body = `${costHTML(def.cost)}${stats([['Research time', `${def.time}s`], ['Research at', BUILDINGS[def.building].name]])}${requirements(def.age, (def.requires ?? []).map(building => BUILDINGS[building].name))}`;
    return card(type, 'technology', def.name, def.description, body, techAvailability(engine, type), key);
  });
  const context = player ? `${CIVS[player.civ].name} · ${ageName(player.age)}. ${CIVS[player.civ].bonus}` : 'The complete skirmish catalog. Start a match to see current requirements and availability.';
  return `<div class="inventory-catalog"><p class="inventory-intro">${escape(context)}</p><nav class="inventory-nav" aria-label="Inventory sections"><a href="#inventory-resources">Resources</a><a href="#inventory-units">Units</a><a href="#inventory-buildings">Buildings</a><a href="#inventory-technologies">Technologies & ages</a></nav><p class="inventory-note">Stats show base values; civilization bonuses and researched upgrades apply in battle. Costs and requirements come directly from the game definitions.</p>${section('resources', 'Resources', 'Four resources power every settlement. Gathered cargo enters your stockpile only after a villager deposits it.', resourceCards)}${section('units', 'Units', 'Eight roles, shared by every civilization. Train a mixed army and protect your economy.', unitCards)}${section('buildings', 'Buildings', 'Completed buildings provide housing, drop-offs, production, research and defenses.', buildingCards)}${section('technologies', 'Technologies & ages', 'Permanent research and four ages unlock the next stage of your civilization.', techCards)}</div>`;
}
