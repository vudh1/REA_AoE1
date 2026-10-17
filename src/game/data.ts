import type {BuildingDef, BuildingType, Civilization, Stock, TechDef, TechId, UnitDef, UnitType} from './types';

/** All simulation durations are seconds, speeds are tiles/second and ages are 1–4. */
export const AGE_NAMES = ['Stone Age', 'Tool Age', 'Bronze Age', 'Iron Age'] as const;

export function stock(cost: Partial<Stock> = {}): Stock {
  return {food: cost.food ?? 0, wood: cost.wood ?? 0, gold: cost.gold ?? 0, stone: cost.stone ?? 0};
}

export const CIVS: Record<Civilization, {name: string; description: string; bonus: string}> = {
  river: {name: 'River Kingdom', description: 'Patient farmers and merchants of the great river valleys.', bonus: 'Farm gathering is 15% faster.'},
  highland: {name: 'Highland Clans', description: 'Resilient infantry and stoneworkers from the mountain settlements.', bonus: 'Infantry have 10% more health. Walls and towers have 15% more health.'},
  steppe: {name: 'Steppe Confederacy', description: 'Far-ranging scouts and swift riders of the open plains.', bonus: 'Cavalry move 10% faster. Scouts see 2 tiles farther.'},
};

export const UNITS: Record<UnitType, UnitDef> = {
  villager: {name: 'Villager', description: 'Gathers, carries and deposits resources; builds and repairs settlements.', cost: {food: 50}, time: 20, population: 1, hp: 35, speed: 1.75, sight: 7, damage: 3, range: 0.85, cooldown: 1.6, armor: 0, age: 1, building: 'towncenter', targets: ['unit', 'building']},
  scout: {name: 'Scout', description: 'Fast explorer. Excellent vision, but weak in a stand-up fight.', cost: {food: 70}, time: 25, population: 1, hp: 55, speed: 2.65, sight: 11, damage: 3, range: 0.9, cooldown: 1.4, armor: 0, age: 1, building: 'towncenter', targets: ['unit', 'building']},
  infantry: {name: 'Club Infantry', description: 'Affordable frontline soldier. Vulnerable to archers.', cost: {food: 55, wood: 15}, time: 20, population: 1, hp: 65, speed: 1.75, sight: 7, damage: 7, range: 0.9, cooldown: 1.25, armor: 1, age: 1, building: 'barracks', targets: ['unit', 'building']},
  spearman: {name: 'Spearman', description: 'Long spears deliver powerful bonus damage against riders.', cost: {food: 45, wood: 35}, time: 23, population: 1, hp: 60, speed: 1.7, sight: 7, damage: 5, range: 1.15, cooldown: 1.35, armor: 0, age: 2, building: 'barracks', bonus: {cavalry: 17, scout: 10}, targets: ['unit', 'building']},
  archer: {name: 'Archer', description: 'Ranged support that excels against lightly armored infantry.', cost: {wood: 45, gold: 25}, time: 25, population: 1, hp: 40, speed: 1.65, sight: 9, damage: 5, range: 6, cooldown: 1.65, armor: 0, age: 2, building: 'range', bonus: {infantry: 3, spearman: 3, villager: 2}, targets: ['unit', 'building']},
  cavalry: {name: 'Cavalry', description: 'Swift raiders that threaten archers and exposed siege. Beware spears.', cost: {food: 85, gold: 55}, time: 30, population: 1, hp: 115, speed: 2.45, sight: 8, damage: 10, range: 1, cooldown: 1.3, armor: 2, age: 3, building: 'stable', bonus: {archer: 5, siege: 9}, targets: ['unit', 'building']},
  heavy: {name: 'Heavy Infantry', description: 'An armored Iron Age frontline: durable, powerful and slow.', cost: {food: 80, gold: 65}, time: 30, population: 1, hp: 155, speed: 1.4, sight: 7, damage: 15, range: 1, cooldown: 1.5, armor: 5, age: 4, building: 'barracks', targets: ['unit', 'building']},
  siege: {name: 'Stone Thrower', description: 'Long-range siege engine. Devastates buildings but needs protection.', cost: {wood: 160, gold: 100}, time: 35, population: 3, hp: 100, speed: 1.05, sight: 10, damage: 16, range: 8, cooldown: 4, armor: 1, age: 3, building: 'workshop', bonus: {building: 42}, targets: ['unit', 'building']},
};

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  towncenter: {name: 'Town Center', description: 'The heart of a settlement. Trains villagers and scouts, advances ages and accepts every resource.', cost: {wood: 300, stone: 150}, time: 60, hp: 1500, size: 5, age: 1, population: 10, dropoff: ['food', 'wood', 'gold', 'stone'], produces: ['villager', 'scout'], sight: 11},
  house: {name: 'House', description: 'Provides room for 5 additional population when completed.', cost: {wood: 35}, time: 18, hp: 350, size: 2, age: 1, population: 5, sight: 5},
  granary: {name: 'Granary', description: 'Nearby food drop-off. Required, with a Barracks, to reach the Tool Age.', cost: {wood: 80}, time: 25, hp: 450, size: 3, age: 1, dropoff: ['food'], sight: 6},
  storage: {name: 'Storage Pit', description: 'Drop-off for wood, gold and stone. Shorter carrying routes improve the economy.', cost: {wood: 70}, time: 25, hp: 450, size: 3, age: 1, dropoff: ['wood', 'gold', 'stone'], sight: 6},
  farm: {name: 'Farm', description: 'A finite field containing 350 food. Villagers gather and carry its harvest normally.', cost: {wood: 60}, time: 20, hp: 250, size: 3, age: 2, requires: 'granary', sight: 4},
  market: {name: 'Market', description: 'Research gathering efficiency and carrying capacity. Required for the Bronze Age.', cost: {wood: 140}, time: 35, hp: 650, size: 4, age: 2, requires: 'granary', sight: 7},
  barracks: {name: 'Barracks', description: 'Trains club infantry, spearmen and heavy infantry.', cost: {wood: 120}, time: 30, hp: 700, size: 3, age: 1, produces: ['infantry', 'spearman', 'heavy'], sight: 7},
  range: {name: 'Archery Range', description: 'Trains archers. Required, with a Market, to reach the Bronze Age.', cost: {wood: 160}, time: 35, hp: 650, size: 3, age: 2, requires: 'barracks', produces: ['archer'], sight: 7},
  stable: {name: 'Stable', description: 'Trains fast cavalry to raid and counter ranged armies.', cost: {wood: 180}, time: 40, hp: 750, size: 3, age: 3, requires: 'barracks', produces: ['cavalry'], sight: 7},
  workshop: {name: 'Siege Workshop', description: 'Builds stone throwers. Required, with an Academy, to reach the Iron Age.', cost: {wood: 200, gold: 100}, time: 45, hp: 800, size: 4, age: 3, requires: 'market', produces: ['siege'], sight: 7},
  tower: {name: 'Watch Tower', description: 'Automatically fires at visible enemies. Research stronger arrows at the Academy.', cost: {wood: 60, stone: 100}, time: 40, hp: 800, size: 2, age: 2, requires: 'granary', sight: 10},
  wall: {name: 'Stone Wall', description: 'Blocks movement and protects narrow approaches. Destroyed walls reopen the route.', cost: {stone: 8}, time: 15, hp: 600, size: 1, age: 2, sight: 3},
  gate: {name: 'Gate', description: 'Friendly units may pass. Toggle open to permit passage by every civilization.', cost: {wood: 20, stone: 35}, time: 22, hp: 750, size: 2, age: 2, sight: 4},
  academy: {name: 'Academy', description: 'Research military attack, armor, health and fortification improvements.', cost: {wood: 180, gold: 150}, time: 45, hp: 750, size: 3, age: 3, requires: 'market', sight: 7},
};

export const TECHS: Record<TechId, TechDef> = {
  gather: {name: 'Improved Tools', description: 'All gathering is 25% faster.', cost: {food: 120, wood: 80}, time: 35, age: 2, building: 'market'},
  carry: {name: 'Woven Baskets', description: 'Villagers carry 5 more resources per trip.', cost: {food: 100, wood: 100}, time: 30, age: 2, building: 'market'},
  infantry: {name: 'Forged Blades', description: 'Infantry, spearmen and heavy infantry gain 2 attack damage.', cost: {food: 160, gold: 100}, time: 40, age: 3, building: 'academy'},
  ranged: {name: 'Balanced Shafts', description: 'Archers gain 2 attack damage.', cost: {wood: 160, gold: 100}, time: 40, age: 3, building: 'academy'},
  armor: {name: 'Bronze Armor', description: 'Military units gain 1 armor.', cost: {food: 180, gold: 140}, time: 45, age: 3, building: 'academy'},
  health: {name: 'Field Medicine', description: 'Units gain 20% maximum health.', cost: {food: 220, gold: 150}, time: 45, age: 3, building: 'academy'},
  durability: {name: 'Masonry', description: 'Buildings gain 20% maximum health.', cost: {wood: 180, stone: 140}, time: 45, age: 3, building: 'academy'},
  tower: {name: 'Fortified Towers', description: 'Watch Towers gain 3 attack damage and 1 range.', cost: {wood: 120, stone: 160}, time: 40, age: 3, building: 'academy'},
  age2: {name: 'Tool Age', description: 'Unlocks farms, markets, archers, spearmen, towers, walls and gates.', cost: {food: 450, wood: 150}, time: 65, age: 1, building: 'towncenter', requires: ['granary', 'barracks']},
  age3: {name: 'Bronze Age', description: 'Unlocks cavalry, siege engines, the Academy and military research.', cost: {food: 750, gold: 250}, time: 85, age: 2, building: 'towncenter', requires: ['market', 'range']},
  age4: {name: 'Iron Age', description: 'Unlocks heavy infantry to anchor a powerful late-game army.', cost: {food: 1100, gold: 650}, time: 100, age: 3, building: 'towncenter', requires: ['academy', 'workshop']},
};
