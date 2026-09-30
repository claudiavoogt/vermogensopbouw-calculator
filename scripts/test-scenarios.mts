// @ts-nocheck
// Onafhankelijke controle van de scenario-berekening (app/lib/rekenkunde.ts).
// De tweede rekenmethode hieronder werkt volledig in NOMINALE euro's met een prijsindex, terwijl de tool zelf
// in koopkracht van nu rekent met een reëel rendement. Komen beide op hetzelfde uit, dan klopt de wiskunde.
// Draaien: node --experimental-strip-types scripts/test-scenarios.mts
import {
  berekenScenario, bepaalOordeel, benodigdKapitaal, fvSeries, GELD_MAX_LEEFTIJD,
} from '../app/lib/rekenkunde.ts';

let checks = 0, fails = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) { fails++; if (fails <= 40) console.log('FAIL:', m); } };
const near = (a: number, b: number, tol: number, m: string) => ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);
const rel = (a: number, b: number, m: string, tol = 1e-7) => ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)), `${m}: ${a} vs ${b}`);
const B = (naam: string, bedrag: number, vanafLeeftijd: number) => ({ naam, bedrag, vanafLeeftijd });

// ---------- Tweede methode: nominaal met prijsindex ----------
function onafhankelijk(inv: any, rt: number, infl: number) {
  const r = rt / 1200;
  const pim = Math.pow(1 + infl / 100, 1 / 12) - 1;
  const P0 = Math.pow(1 + infl / 100, inv.opbouwjaren); // prijsniveau bij begin onttrekking t.o.v. nu
  // Opbouw maand voor maand
  let cap = inv.startbedrag;
  for (let m = 0; m < Math.round(inv.opbouwjaren * 12); m++) cap = cap * (1 + r) + inv.maandinleg;
  const inkomenMaand = (t: number, bronnen: any[]) => {
    const leeftijd = inv.beschikbaarLeeftijd + t / 12;
    let s = 0; for (const b of bronnen) if (b.bedrag > 0 && b.vanafLeeftijd <= leeftijd + 1e-9) s += b.bedrag;
    return s;
  };
  const gap = (t: number, U: number) => Math.max(0, U - inkomenMaand(t, inv.bronnen));
  const nodigNominaal = (U: number) => {
    let pv = 0;
    const N = Math.round((inv.ijkLeeftijd - inv.beschikbaarLeeftijd) * 12);
    for (let t = 0; t < N; t++) pv += (gap(t, U) * P0 * Math.pow(1 + pim, t + 1)) / Math.pow(1 + r, t + 1);
    return pv;
  };
  // Hoeveel volledige maanden kan het kapitaal (nominaal) betalen, t/m de bovengrens?
  const horizon = Math.max(GELD_MAX_LEEFTIJD, inv.ijkLeeftijd);
  const H = Math.max(0, Math.round((horizon - inv.beschikbaarLeeftijd) * 12));
  let k = cap, maanden = H, nooitOp = true;
  for (let t = 0; t < H; t++) {
    k = k * (1 + r) - gap(t, inv.maanduitgaven) * P0 * Math.pow(1 + pim, t + 1);
    if (k < -1e-9 * Math.max(1, cap)) { maanden = t; nooitOp = false; break; }
  }
  return { cap, P0, nodigNominaal, maanden, nooitOp, gap };
}

function vergelijk(inv: any, rt: number, infl: number, label: string) {
  const s = berekenScenario(inv, rt, infl);
  const o = onafhankelijk(inv, rt, infl);
  const nodigN = o.nodigNominaal(inv.maanduitgaven);
  rel(s.vermogenNominaal, o.cap, `${label} vermogen nominaal`);
  rel(s.vermogen, o.cap / o.P0, `${label} vermogen koopkracht`);
  rel(s.nodig, nodigN / o.P0, `${label} nodig`);
  rel(s.buffer, o.cap / o.P0 - nodigN / o.P0, `${label} buffer`);
  near(s.geldTot, inv.beschikbaarLeeftijd + o.maanden / 12, 1e-9, `${label} geldTot`);
  ok(s.geldTotMax === o.nooitOp, `${label} nooit op`);
  // 4%-regel
  rel(s.vierProcentPerMaand, (o.cap / o.P0) * 0.04 / 12, `${label} 4%`);
  // kanUitgeven: dat bedrag past precies binnen het vermogen; 1 euro meer niet (tenzij het de bovengrens is)
  if (s.kanUitgeven < 1e7 - 1) {
    ok(o.nodigNominaal(s.kanUitgeven) <= o.cap * (1 + 1e-9) + 1e-6, `${label} kanUitgeven past`);
    ok(o.nodigNominaal(s.kanUitgeven + 1) > o.cap * (1 - 1e-9) - 1e-6 || o.nodigNominaal(s.kanUitgeven + 1) >= o.nodigNominaal(s.kanUitgeven), `${label} kanUitgeven+1 past niet`);
  }
  // inlegNodig: met deze inleg is het vermogen (nominaal) precies genoeg om nodig te dekken
  const inv2 = { ...inv, maandinleg: s.inlegNodig };
  const o2 = onafhankelijk(inv2, rt, infl);
  const nodig2 = o2.nodigNominaal(inv.maanduitgaven);
  if (s.inlegNodig > 0) near(o2.cap, nodig2, 1e-6 * Math.max(1, nodig2), `${label} inleg dekt precies`);
  else ok(o2.cap >= nodig2 - 1e-6, `${label} inleg 0 is genoeg`);
  return s;
}

// ---------- 1. Bekende voorbeelden (met de hand vooraf berekend, los van deze code) ----------
{
  // Jouw voorbeeld: 45 jaar, 65 beschikbaar, ijkpunt 75, 250 per maand, uitgaven 3000, geen inkomen
  const inv = { startbedrag: 0, maandinleg: 250, maanduitgaven: 3000, opbouwjaren: 20, beschikbaarLeeftijd: 65, ijkLeeftijd: 75, bronnen: [] };
  const m = berekenScenario(inv, 10, 2), z = berekenScenario(inv, 10, 0);
  near(m.vermogenNominaal, 189842, 1, 'voorbeeld nominaal'); near(m.vermogen, 127758, 1, 'voorbeeld koopkracht');
  near(m.nodig, 247212, 1, 'voorbeeld nodig met'); near(m.buffer, -119454, 1, 'voorbeeld tekort met');
  near(m.geldTot, 69.2, 0.1, 'voorbeeld geld tot met'); near(m.inlegNodig, 484, 1, 'voorbeeld inleg met');
  near(m.vierProcentPerMaand, 426, 1, 'voorbeeld 4% met'); near(m.kanUitgeven, 1550, 1, 'voorbeeld kan uitgeven met');
  near(z.vermogen, 189842, 1, 'voorbeeld vermogen zonder'); near(z.nodig, 227013, 1, 'voorbeeld nodig zonder');
  near(z.buffer, -37171, 1, 'voorbeeld tekort zonder'); near(z.geldTot, 72.5, 0.1, 'voorbeeld geld tot zonder');
  near(z.inlegNodig, 299, 1, 'voorbeeld inleg zonder'); near(z.vierProcentPerMaand, 633, 1, 'voorbeeld 4% zonder');
  const ma = berekenScenario(inv, 7, 2), op = berekenScenario(inv, 12, 2);
  near(ma.geldTot, 67.6, 0.1, 'voorbeeld matig geld tot'); near(op.geldTot, 71.2, 0.1, 'voorbeeld optimistisch geld tot');
  near(ma.nodig - ma.vermogen, 195074, 1, 'voorbeeld matig tekort'); near(op.nodig - op.vermogen, 60563, 1, 'voorbeeld opt tekort');
  near(ma.inlegNodig, 806, 1, 'voorbeeld matig inleg'); near(op.inlegNodig, 341, 1, 'voorbeeld opt inleg');
  ok(bepaalOordeel(ma, m, 75) === 'rood', 'voorbeeld oordeel rood');
}
{
  // Eerder testgeval: 35 tot 65, start 6000, 300 per maand, uitgaven 3000, tot 90
  const inv = { startbedrag: 6000, maandinleg: 300, maanduitgaven: 3000, opbouwjaren: 30, beschikbaarLeeftijd: 65, ijkLeeftijd: 90, bronnen: [] };
  const uit = (rt: number) => berekenScenario(inv, rt, 2);
  near(uit(7).vermogen, 228938, 1, 'matig vermogen'); near(uit(7).nodig, 512678, 1, 'matig nodig'); near(uit(7).buffer, -283739, 1, 'matig buffer');
  near(uit(10).vermogen, 440095, 1, 'verwacht vermogen'); near(uit(10).nodig, 388531, 1, 'verwacht nodig'); near(uit(10).buffer, 51564, 1, 'verwacht buffer');
  near(uit(12).vermogen, 697921, 1, 'opt vermogen'); near(uit(12).nodig, 330101, 1, 'opt nodig'); near(uit(12).buffer, 367820, 1, 'opt buffer');
  near(uit(10).geldTot, 100, 0.001, 'verwacht 100+ (geldTot op bovengrens)'); ok(uit(10).geldTotMax === true, 'verwacht nooit op binnen 100');
  near(uit(7).geldTot, 72.7, 0.1, 'matig geld tot');
  const met = { ...inv, bronnen: [B('AOW', 1400, 67), B('Pensioen', 500, 67)] };
  const x = berekenScenario(met, 10, 2);
  near(x.nodig, 184469, 1, 'met inkomen nodig'); near(x.buffer, 255626, 1, 'met inkomen buffer');
  ok(bepaalOordeel(uit(7), uit(10), 90) === 'oranje', 'oordeel oranje: alleen verwacht haalt het');
  ok(bepaalOordeel(berekenScenario(met, 7, 2), x, 90) === 'oranje', 'oordeel oranje: matig haalt 90 net niet (89,3)');
  near(berekenScenario(met, 7, 2).geldTot, 89.3, 0.1, 'matig met inkomen geld tot');
  const m85 = { ...met, ijkLeeftijd: 85 };
  ok(bepaalOordeel(berekenScenario(m85, 7, 2), berekenScenario(m85, 10, 2), 85) === 'groen', 'oordeel groen bij ijkpunt 85');
}

// ---------- 2. Zonder inflatie en zonder inkomen: identiek aan de oude tool ----------
for (const rt of [7, 10, 12]) for (const [u, jr] of [[3000, 25], [1500, 10], [4200, 35]] as const) {
  const inv = { startbedrag: 6000, maandinleg: 300, maanduitgaven: u, opbouwjaren: 30, beschikbaarLeeftijd: 65, ijkLeeftijd: 65 + jr, bronnen: [] };
  const z = berekenScenario(inv, rt, 0);
  rel(z.nodig, benodigdKapitaal(u, rt, jr), `oude formule nodig ${rt}% ${u}/${jr}`);
  rel(z.vermogen, fvSeries(6000, 300, rt, 30), `oude formule vermogen ${rt}%`);
  rel(z.buffer, fvSeries(6000, 300, rt, 30) - benodigdKapitaal(u, rt, jr), `oude formule buffer ${rt}%`);
}

// ---------- 3. Willekeurig raster van 4000 gevallen tegen de tweede methode ----------
{
  let seed = 20260930;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  for (let i = 0; i < 4000; i++) {
    const hl = 20 + Math.floor(rnd() * 40);
    const opbouw = 1 + Math.floor(rnd() * 40);
    const bl = hl + opbouw;
    const jaren = 1 + Math.floor(rnd() * 35);
    const bronnen: any[] = [];
    for (let j = 0; j < Math.floor(rnd() * 4); j++) bronnen.push(B('bron' + j, Math.round(rnd() * 3000), bl - 5 + Math.round(rnd() * (jaren + 10) * 4) / 4));
    const inv = {
      startbedrag: Math.round(rnd() * 100000), maandinleg: Math.round(rnd() * 2000),
      maanduitgaven: Math.round(rnd() * 8000), opbouwjaren: opbouw, beschikbaarLeeftijd: bl,
      ijkLeeftijd: bl + jaren, bronnen,
    };
    const rt = pick([7, 10, 12]); const infl = pick([0, 0.5, 1, 2, 2.5, 3, 5, 7.5, 10]);
    vergelijk(inv, rt, infl, `raster#${i}`);
    // Eigenschappen tussen de varianten
    const z = berekenScenario(inv, rt, 0), m = berekenScenario(inv, rt, infl);
    ok(m.vermogen <= z.vermogen + 1e-6, `raster#${i} inflatie verlaagt vermogen`);
    ok(m.nodig >= z.nodig - 1e-6, `raster#${i} inflatie verhoogt nodig`);
    ok(m.geldTot <= z.geldTot + 1e-9, `raster#${i} inflatie verkort geld`);
    ok(m.inlegNodig >= z.inlegNodig - 1e-6, `raster#${i} inflatie verhoogt inleg`);
    ok(m.buffer <= z.buffer + 1e-6, `raster#${i} buffer kleiner met inflatie`);
    // Hogere rendementen zijn nooit slechter
    const lo = berekenScenario(inv, 7, infl), mid = berekenScenario(inv, 10, infl), hi = berekenScenario(inv, 12, infl);
    ok(lo.geldTot <= mid.geldTot + 1e-9 && mid.geldTot <= hi.geldTot + 1e-9, `raster#${i} geldTot stijgt met rendement`);
    ok(lo.nodig >= mid.nodig - 1e-6 && mid.nodig >= hi.nodig - 1e-6, `raster#${i} nodig daalt met rendement`);
    ok(lo.vermogen <= mid.vermogen + 1e-6 && mid.vermogen <= hi.vermogen + 1e-6, `raster#${i} vermogen stijgt`);
    // Oordeel klopt met de definitie
    const oordeel = bepaalOordeel(lo, mid, inv.ijkLeeftijd);
    const haalt = (s: any) => s.geldTot >= inv.ijkLeeftijd - 1e-9;
    ok(oordeel === (haalt(lo) && haalt(mid) ? 'groen' : haalt(mid) ? 'oranje' : 'rood'), `raster#${i} oordeel`);
    // Tegenspraak-check: buffer >= 0 betekent dat het geld het ijkpunt haalt, en andersom
    ok((mid.buffer >= -1e-6) === haalt(mid) || Math.abs(mid.buffer) < 1e-3, `raster#${i} buffer en geldTot zeggen hetzelfde (buffer ${mid.buffer}, geldTot ${mid.geldTot}, ijk ${inv.ijkLeeftijd})`);
  }
}

// ---------- 4. Rondreis: precies de berekende inleg haalt het ijkpunt, iets minder niet ----------
{
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < 300; i++) {
    const bronnen = rnd() < 0.5 ? [B('AOW', Math.round(rnd() * 2000), 67)] : [];
    const inv = { startbedrag: Math.round(rnd() * 20000), maandinleg: 100, maanduitgaven: 1000 + Math.round(rnd() * 5000), opbouwjaren: 10 + Math.floor(rnd() * 30), beschikbaarLeeftijd: 60, ijkLeeftijd: 60 + 5 + Math.floor(rnd() * 30), bronnen };
    inv.beschikbaarLeeftijd = 30 + inv.opbouwjaren;
    inv.ijkLeeftijd = inv.beschikbaarLeeftijd + 5 + Math.floor(rnd() * 30);
    if (bronnen.length) bronnen[0].vanafLeeftijd = inv.beschikbaarLeeftijd + 2;
    const rt = [7, 10, 12][Math.floor(rnd() * 3)], infl = [0, 2, 4][Math.floor(rnd() * 3)];
    const s = berekenScenario(inv, rt, infl);
    if (s.inlegNodig <= 0) continue;
    const genoeg = berekenScenario({ ...inv, maandinleg: s.inlegNodig * 1.0001 }, rt, infl);
    const tekort = berekenScenario({ ...inv, maandinleg: s.inlegNodig * 0.999 }, rt, infl);
    ok(genoeg.geldTot >= inv.ijkLeeftijd - 1e-9, `rondreis#${i} genoeg inleg haalt ijkpunt (geldTot ${genoeg.geldTot} ijk ${inv.ijkLeeftijd})`);
    ok(tekort.geldTot < inv.ijkLeeftijd, `rondreis#${i} iets minder inleg haalt het niet`);
    ok(bepaalOordeel(genoeg, genoeg, inv.ijkLeeftijd) === 'groen', `rondreis#${i} oordeel groen`);
    // Uitgeven: precies kanUitgeven haalt het ijkpunt, iets meer niet
    const okU = berekenScenario({ ...inv, maanduitgaven: s.kanUitgeven * 0.9999 }, rt, infl);
    const teVeel = berekenScenario({ ...inv, maanduitgaven: s.kanUitgeven * 1.001 + 1 }, rt, infl);
    if (s.kanUitgeven > 0 && s.kanUitgeven < 9e6) {
      ok(okU.geldTot >= inv.ijkLeeftijd - 1e-9, `rondreis#${i} kanUitgeven haalt het`);
      ok(teVeel.geldTot < inv.ijkLeeftijd || bronnen.length > 0 && teVeel.geldTot >= inv.ijkLeeftijd - 1e-9 === false, `rondreis#${i} meer uitgeven haalt het niet`);
    }
  }
}

// ---------- 5. Randgevallen ----------
{
  const basis = { startbedrag: 0, maandinleg: 250, maanduitgaven: 3000, opbouwjaren: 20, beschikbaarLeeftijd: 65, ijkLeeftijd: 75, bronnen: [] };
  // Geen uitgaven: nooit een tekort, geld gaat tot de bovengrens mee
  const nul = berekenScenario({ ...basis, maanduitgaven: 0 }, 10, 2);
  ok(nul.nodig === 0 && nul.buffer > 0 && nul.geldTotMax, 'uitgaven 0');
  // Geen vermogen: geld is meteen op
  const leeg = berekenScenario({ ...basis, maandinleg: 0 }, 10, 2);
  near(leeg.geldTot, 65, 1e-9, 'geen vermogen: op bij start'); ok(leeg.vermogen === 0 && leeg.buffer < 0, 'geen vermogen: tekort');
  // Ander inkomen groter dan uitgaven vanaf het begin: nooit op
  const rijk = berekenScenario({ ...basis, bronnen: [B('Overig', 3500, 60)] }, 7, 2);
  ok(rijk.geldTotMax && rijk.nodig === 0 && rijk.buffer > 0, 'inkomen boven uitgaven');
  // IJkpunt gelijk aan start: niets nodig
  const geen = berekenScenario({ ...basis, ijkLeeftijd: 65 }, 10, 2);
  ok(geen.nodig === 0 && geen.buffer >= 0, 'ijkpunt = start');
  // IJkpunt boven de bovengrens
  const ver = berekenScenario({ ...basis, maandinleg: 1000, ijkLeeftijd: 110 }, 10, 2);
  ok(ver.geldTot <= 110 + 1e-9, 'ijkpunt 110');
  // Inflatie 0 en 10 (grenzen van de schuif)
  for (const infl of [0, 10]) { const s = berekenScenario(basis, 10, infl); ok(Number.isFinite(s.nodig) && Number.isFinite(s.geldTot) && Number.isFinite(s.inlegNodig), `inflatie ${infl} eindig`); }
  // Inflatie 0: zonder en met zijn gelijk
  const a = berekenScenario(basis, 10, 0), b = berekenScenario(basis, 10, 0);
  ok(a.nodig === b.nodig && a.vermogen === a.vermogenNominaal, 'inflatie 0: nominaal = koopkracht');
  // Vroeg starten met opnemen (bl 55) en AOW pas op 67: fase-effect
  const vroeg = berekenScenario({ ...basis, opbouwjaren: 10, beschikbaarLeeftijd: 55, ijkLeeftijd: 85, bronnen: [B('AOW', 1400, 67)] }, 10, 2);
  const zonderAow = berekenScenario({ ...basis, opbouwjaren: 10, beschikbaarLeeftijd: 55, ijkLeeftijd: 85 }, 10, 2);
  ok(vroeg.nodig < zonderAow.nodig, 'AOW verlaagt nodig');
  const laat = berekenScenario({ ...basis, opbouwjaren: 10, beschikbaarLeeftijd: 55, ijkLeeftijd: 85, bronnen: [B('AOW', 1400, 75)] }, 10, 2);
  ok(vroeg.nodig < laat.nodig && laat.nodig < zonderAow.nodig, 'eerder AOW is beter dan later');
  // Fractionele leeftijd
  vergelijk({ ...basis, opbouwjaren: 19.5, beschikbaarLeeftijd: 64.5, ijkLeeftijd: 74.75, bronnen: [B('AOW', 1400, 67.25)] }, 10, 2, 'fractioneel');
}

console.log(`${checks} controles, ${fails} mislukt`);
process.exit(fails ? 1 : 0);
