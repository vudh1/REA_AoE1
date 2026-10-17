export type Resource = 'food'|'wood'|'gold'|'stone';
export type Stock = Record<Resource,number>;
export type UnitType = 'villager'|'scout'|'infantry'|'spearman'|'archer'|'cavalry'|'heavy'|'siege';
export type BuildingType = 'towncenter'|'house'|'granary'|'storage'|'farm'|'market'|'barracks'|'range'|'stable'|'workshop'|'tower'|'wall'|'gate'|'academy';
export type TechId = 'gather'|'carry'|'infantry'|'ranged'|'armor'|'health'|'durability'|'tower'|'age2'|'age3'|'age4';
export type Civilization = 'river'|'highland'|'steppe';
export type Terrain = 0|1|2|3;
export interface Point {x:number;y:number}
export interface Order extends Point { type:'move'|'attackMove'|'attack'|'gather'|'build'|'repair'|'deposit'|'hold'|'stop'; target?:number;resource?:Resource; }
export interface QueueItem {kind:'unit'|'tech';type:UnitType|TechId;progress:number;time:number;cost:Stock;population:number}
export interface Entity extends Point {
 id:number; owner:number; kind:'unit'|'building'|'resource'; type:UnitType|BuildingType|'tree'|'berries'|'gold'|'stone'|'deer';
 hp:number;maxHp:number; radius:number; completed:boolean;progress:number;
 amount:number; resource?:Resource; carry:number;carryType?:Resource; orders:Order[];path:Point[];
 cooldown:number;work:number;queue:QueueItem[];rally?:Point;task:string; facing:number; prevX:number;prevY:number;
 stuck:number; repath:number; home?:Point; lastHit:number; open?:boolean;
}
export interface Stats {gathered:number;trained:number;lost:number;kills:number;built:number;destroyed:number}
export interface AIState {nextDecision:number;phase:string;nextAttack:number;scoutIndex:number;lastBuild:number;target?:Point;issuedCommands?:number;failedCommands?:number;lastFailure?:string;lastExplore?:number;attacks?:number}
export interface Player {id:number;name:string;civ:Civilization;color:string;age:number;resources:Stock;techs:TechId[];defeated:boolean;stats:Stats;ai?:AIState;explored:number[];visible:number[];memory:Record<string,Entity>}
export interface MatchSettings {seed:string;size:'small'|'medium'|'large';opponents:number;difficulty:'easy'|'normal'|'hard';resources:'standard'|'abundant';population:50|100|150;civ:Civilization;aiCiv:Civilization|'random';color:string;speed:number;peaceful:boolean;tutorial:boolean;cleanup:boolean}
export interface WorldMap {size:number;tiles:Terrain[];starts:Point[];generation:number;seed:string}
export interface GameEvent {tick:number;type:string;owner:number;text:string;x?:number;y?:number;entity?:number}
export interface Projectile {id:number;owner:number;target:number;x:number;y:number;tx:number;ty:number;damage:number;life:number;total:number;style:string}
export interface GameState {version:1;settings:MatchSettings;map:WorldMap;tick:number;nextId:number;rng:number;entities:Entity[];players:Player[];projectiles:Projectile[];events:GameEvent[];paused:boolean;result:'playing'|'victory'|'defeat';tutorialStep:number;}
export interface UnitDef {name:string;description:string;cost:Partial<Stock>;time:number;population:number;hp:number;speed:number;sight:number;damage:number;range:number;cooldown:number;armor:number;age:number;building:BuildingType;bonus?:Partial<Record<UnitType|'building',number>>;targets:('unit'|'building')[]}
export interface BuildingDef {name:string;description:string;cost:Partial<Stock>;time:number;hp:number;size:number;age:number;requires?:BuildingType;population?:number;dropoff?:Resource[];produces?:UnitType[];sight:number}
export interface TechDef {name:string;description:string;cost:Partial<Stock>;time:number;age:number;building:BuildingType;requires?:BuildingType[];}
export type Command =
 | {type:'order';ids:number[];order:Order;queue?:boolean}
 | {type:'build';building:BuildingType;x:number;y:number;builders:number[]}
 | {type:'train';ids:number[];unit:UnitType}
 | {type:'research';id:number;tech:TechId}
 | {type:'cancel';id:number;index?:number}
 | {type:'rally';ids:number[];x:number;y:number}
 | {type:'gate';id:number}
 | {type:'resign'};
export interface Result {ok:boolean;reason?:string;id?:number}
export const DEFAULT_SETTINGS:MatchSettings={seed:'AURELIA',size:'medium',opponents:1,difficulty:'normal',resources:'standard',population:100,civ:'river',aiCiv:'random',color:'#5cbdc6',speed:1,peaceful:false,tutorial:false,cleanup:false};
