// ═══════════════════════════════════════════════════════════════════
// IMPORT DEDUP TEST — findMatchingExistingFlight
//
// Audit item 13 (Martin 2026-07-08): the block-only fallback (Tier 4) merged
// ANY two same-day flights whose block times were within 9 min, even with
// different flight numbers and routes — so importing PD428 (2.67 h) silently
// dropped it as a "duplicate" of PD291 (2.73 h) flown the same day. Tier 4 now
// only fires for legacy rows that carry neither a flight number nor a route.
//
// Run:  node test/dedup.mjs   (also part of `npm test`)
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM(readFileSync(join(root,'logbook.html'),'utf8'), {
  runScripts:'dangerously', url:'https://logbook-cxy.pages.dev/', virtualConsole:new VirtualConsole(),
  beforeParse(w){const c=function(){return{destroy(){},update(){},resize(){}}};c.register=()=>{};w.Chart=c;if(!w.matchMedia)w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});w.scrollTo=()=>{};}});
const w = dom.window; const fail=[]; const chk=(l,c)=>{ if(!c) fail.push(l); };
const match = (inc) => JSON.parse(w.eval('JSON.stringify(findMatchingExistingFlight('+JSON.stringify(inc)+'))'));

w.eval("flights=[{id:'x',date:'2026-01-06',flightNum:'PD291',route:'YOW-YWG',block:2.73},{id:'y',date:'2026-01-06',flightNum:'PD167',route:'YYZ-YOW',block:1.58}]");
chk('distinct flightNum+route with close block does NOT merge (PD428 vs PD291)', match({date:'2026-01-06',flightNum:'PD428',route:'YWG-YYZ',block:2.67})===null);
chk('identical re-import still dedupes (exact)', (match({date:'2026-01-06',flightNum:'PD291',route:'YOW-YWG',block:2.73})||{}).matchType==='exact');
chk('same flightNum, different block still dedupes', ['exact','date-flightnum'].includes((match({date:'2026-01-06',flightNum:'PD291',route:'YOW-YWG',block:2.9})||{}).matchType));
chk('same date+route+close block dedupes (no flightNum)', (match({date:'2026-01-06',route:'YOW-YWG',block:2.75})||{}).matchType!==undefined);

w.eval("flights=[{id:'z',date:'2026-01-06',block:2.70}]");
chk('legacy row (no flightNum/route) still block-matches', (match({date:'2026-01-06',block:2.67})||{}).matchType==='date-block');

if(fail.length){ console.error('\n✗ dedup test: '+fail.length+' failure(s)'); fail.forEach(f=>console.error('  • '+f)); process.exit(1); }
console.log('✓ dedup test passed — block-only match is legacy-only; distinct flights never merged');
process.exit(0);
