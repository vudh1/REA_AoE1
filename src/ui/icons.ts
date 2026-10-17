export function icon(name:string,size=22):string {
const paths:Record<string,string>={
 food:'<path d="M12 4c-3-3-7 0-7 4 0 7 5 11 7 11s7-4 7-11c0-4-4-7-7-4Z"/><path d="M12 5c0-3 2-4 4-4M12 4 9 1"/>',
 wood:'<path d="m12 2 7 9h-4l6 7H3l6-7H5Z"/><path d="M12 18v4"/>',
 gold:'<path d="m8 4 8 0 6 15H2Z"/><path d="m8 4 3 15m5-15-5 15M5 11h14"/>',
 stone:'<path d="m3 18 1-9 7-5 8 3 3 11-8 3Z"/><path d="m4 9 9 3 6-5m-6 5 1 9"/>',
 people:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-6c0-5 12-5 12 0v6M16 4c5-1 5 6 1 6m1 3c4 0 4 4 4 7"/>',
 sun:'<circle cx="12" cy="12" r="5"/><path d="M12 0v4m0 16v4M0 12h4m16 0h4M3.5 3.5l3 3m11 11 3 3m-17 0 3-3m11-11 3-3"/>',
 sword:'<path d="m5 20 14-14 1-5-5 1L2 15m0-3 10 10m-8-3-3 3"/>',
 shield:'<path d="M12 2 3 5v7c0 6 9 10 9 10s9-4 9-10V5Z"/><path d="M12 6v12m-5-7h10"/>',
 house:'<path d="m2 11 10-9 10 9M5 9v12h14V9m-10 12v-8h6v8"/>',
 flag:'<path d="M5 22V2m0 1c6-4 8 4 15 0v11c-7 4-9-4-15 0"/>',
 eye:'<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/>',
 book:'<path d="M12 5C8 1 2 3 2 3v17s6-2 10 1c4-3 10-1 10-1V3s-6-2-10 2v16"/>',
 arrow:'<path d="M3 12h17m-7-7 7 7-7 7"/>',pause:'<path d="M7 4v16M17 4v16" stroke-width="4"/>',play:'<path d="m7 3 15 9-15 9Z"/>',
 save:'<path d="M3 2h15l4 4v16H3Zm4 0v7h10V2M7 22V13h11v9"/>',
 gear:'<path d="m9 2 6 0 1 4 4 1 2 5-3 3v4l-5 3-3-3-4 1-4-4 1-4-2-3 3-4h4Z"/><circle cx="12" cy="12" r="3"/>',
 sound:'<path d="m3 9 5 0 6-5v16l-6-5H3Zm15-2c4 3 4 7 0 10m3-13c6 5 6 11 0 16"/>',
 hammer:'<path d="m3 20 12-12M10 3l4-2 8 8-3 3-4-4-3 2-5-5Z"/>',bow:'<path d="M4 2c20 0 20 20 0 20L16 12 4 2Zm0 10h18m-4-3 4 3-4 3"/>',
 horse:'<path d="m4 21 2-8 7-5-1-6 5 3 4 8-5 2-3-4M7 13l6 6v3m0-3 4-3"/>',cross:'<path d="m5 5 14 14M5 19 19 5"/>',stop:'<path d="M5 5h14v14H5Z"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v7h5"/>',chevron:'<path d="m5 8 7 7 7-7"/>',globe:'<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c-7 7-7 13 0 20 7-7 7-13 0-20Z"/>'};
return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]??paths.house}</svg>`;
}
export const typeIcon=(t:string)=>t==='villager'?'hammer':t==='archer'?'bow':['scout','cavalry'].includes(t)?'horse':['infantry','spearman','heavy'].includes(t)?'sword':t==='siege'?'stone':t==='tower'?'shield':['tree'].includes(t)?'wood':['berries','deer','farm'].includes(t)?'food':['gold','stone'].includes(t)?t:'house';
