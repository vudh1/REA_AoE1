import {describe, expect, it} from 'vitest';
import {Engine} from '../src/game/engine';
import {DEFAULT_SETTINGS} from '../src/game/types';

describe('navigation request fairness', () => {
  it('allows a later open-route unit to move while earlier units wait on impossible routes', () => {
    const engine = new Engine({...DEFAULT_SETTINGS, size: 'small', peaceful: true});
    engine.state.entities = [];
    engine.state.map.tiles.fill(0);
    for (const player of engine.state.players) {delete player.ai; player.visible.fill(1); player.explored.fill(1);}
    engine.createBuilding(0, 'towncenter', 15.5, 70.5);
    engine.createBuilding(1, 'towncenter', 80.5, 80.5);
    for (let y = 0; y < 96; y++) engine.state.map.tiles[y * 96 + 30] = 2;
    for (let i = 0; i < 6; i++) {
      const worker = engine.createUnit(0, 'villager', 5.5, 5.5 + i);
      expect(engine.command(0, {type: 'order', ids: [worker.id], order: {type: 'move', x: 70.5, y: worker.y}}).ok).toBe(true);
    }
    const scout = engine.createUnit(0, 'scout', 5.5, 20.5);
    expect(engine.command(0, {type: 'order', ids: [scout.id], order: {type: 'move', x: 15.5, y: 20.5}}).ok).toBe(true);
    engine.step(40);
    expect(scout.x).toBeGreaterThan(9);
    expect(scout.y).toBeCloseTo(20.5, 1);
  });
});
