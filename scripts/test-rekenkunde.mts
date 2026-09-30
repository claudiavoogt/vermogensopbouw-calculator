// @ts-nocheck
import type { InkomenBron } from "../app/lib/rekenkunde.ts";
import {
  benodigdKapitaal, benodigdUitReeks, gatReeks, restkapitaal, fasesUitReeks, inkomenReeks,
} from '../app/lib/rekenkunde.ts';

let fails = 0, checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) { fails++; console.log('FAIL:', msg); } };
const near = (a: number, b: number, tol: number, msg: string) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const B = (naam: string, bedrag: number, vanafLeeftijd: number): InkomenBron => ({ naam, bedrag, vanafLeeftijd });
const pv = (m: number, rate: number, y: number) => benodigdKapitaal(m, rate, y);
const disc = (rate: number, months: number) => Math.pow(1 + rate / 1200, -months);

// 1. Zonder inkomen: identiek aan oude formule
for (const rate of [7, 10, 12]) for (const [u, y] of [[3000, 30], [1500, 20], [4200, 35], [800, 1]] as const) {
  const g = gatReeks(u, [], 60, y);
  near(benodigdUitReeks(g, rate), pv(u, rate, y), 1e-6, `geen inkomen ${rate}% ${u}x${y}`);
}

// 2. Het voorbeeld uit het voorstel, handmatig gesegmenteerd (onafhankelijke methode)
{
  const bronnen = [B('AOW', 1400, 67), B('Pensioen', 500, 67)];
  for (const rate of [7, 10, 12]) {
    const g = gatReeks(3000, bronnen, 60, 30);
    const seg = pv(3000, rate, 7) + pv(1100, rate, 23) * disc(rate, 84);
    near(benodigdUitReeks(g, rate), seg, 1e-6, `voorbeeld gesegmenteerd ${rate}%`);
  }
  near(benodigdUitReeks(gatReeks(3000, bronnen, 60, 30), 10), 239796, 1, 'voorbeeld 10% ~ 239.796');
}

// 3. Drie bronnen op verschillende leeftijden, gesegmenteerd
{
  const bronnen = [B('Overig', 600, 62), B('AOW', 1300, 67), B('Pensioen', 700, 70)];
  const u = 3500;
  for (const rate of [7, 10, 12]) {
    const g = gatReeks(u, bronnen, 60, 30); // 60..90
    const seg =
      pv(u, rate, 2) +
      pv(u - 600, rate, 5) * disc(rate, 24) +
      pv(u - 1900, rate, 3) * disc(rate, 24 + 60) +
      pv(u - 2600, rate, 20) * disc(rate, 24 + 60 + 36);
    near(benodigdUitReeks(g, rate), seg, 1e-6, `3 bronnen gesegmenteerd ${rate}%`);
  }
}

// 4. Vooruit-simulatie: met het berekende kapitaal is het na de laatste opname precies op
{
  const cases: [number, InkomenBron[], number, number][] = [
    [3000, [B('AOW', 1400, 67), B('Pensioen', 500, 67)], 60, 30],
    [3500, [B('Overig', 600, 62), B('AOW', 1300, 67), B('Pensioen', 700, 70)], 55, 40],
    [2000, [B('AOW', 1400, 67)], 67, 25],
    [2500, [B('AOW', 1400, 67.25)], 65, 30],
    [1000, [B('AOW', 1400, 67)], 60, 30], // inkomen groter dan uitgaven
  ];
  for (const [u, br, s, y] of cases) for (const rate of [7, 10, 12]) {
    const g = gatReeks(u, br, s, y);
    const k = benodigdUitReeks(g, rate);
    const rest = restkapitaal(k, g, rate);
    near(rest, 0, 1e-6 * Math.max(1, k), `restkapitaal ${u}/${s}/${y}/${rate}%`);
    // en met 1 euro minder is het niet genoeg
    ok(restkapitaal(k - 1, g, rate) < 0 || k === 0, `net te weinig bij ${u}/${s}/${y}/${rate}%`);
  }
}

// 5. Inkomen groter dan uitgaven: vloer op 0, geen negatief gat
{
  const g = gatReeks(1000, [B('AOW', 1400, 67)], 60, 30);
  ok(g.every((x) => x >= 0), 'gat nooit negatief');
  near(benodigdUitReeks(g, 10), pv(1000, 10, 7), 1e-6, 'na AOW is gat 0');
}

// 6. Randgevallen
{
  // Inkomen loopt al bij start: heel de periode aftrekken
  near(benodigdUitReeks(gatReeks(3000, [B('Overig', 500, 40)], 60, 30), 10), pv(2500, 10, 30), 1e-6, 'inkomen al bezig');
  // Inkomen begint pas na de einddatum: geen effect
  near(benodigdUitReeks(gatReeks(3000, [B('AOW', 1400, 95)], 60, 30), 10), pv(3000, 10, 30), 1e-6, 'na einddatum');
  // Inkomen precies op de laatste maand
  const g = gatReeks(3000, [B('AOW', 1400, 89 + 11 / 12)], 60, 30);
  ok(g[g.length - 1] === 1600 && g[g.length - 2] === 3000, 'laatste maand');
  // Bedrag 0 telt niet mee
  near(benodigdUitReeks(gatReeks(3000, [B('AOW', 0, 67)], 60, 30), 10), pv(3000, 10, 30), 1e-6, 'bedrag 0');
  // Fractionele ingangsleeftijd 67,25 = 3 maanden later dan 67
  const a = benodigdUitReeks(gatReeks(3000, [B('AOW', 1400, 67.25)], 60, 30), 10);
  const seg = pv(3000, 10, 7.25) + pv(1600, 10, 22.75) * disc(10, 87);
  near(a, seg, 1e-6, 'ingangsleeftijd 67,25');
  // Geen onttrekking
  ok(gatReeks(3000, [B('AOW', 1400, 67)], 60, 0).length === 0, 'geen jaren');
  // Meer inkomen = minder kapitaal, altijd
  let vorige = Infinity;
  for (const bedrag of [0, 200, 800, 1500, 2500, 3500]) {
    const k = benodigdUitReeks(gatReeks(3000, [B('AOW', bedrag, 67)], 60, 30), 10);
    ok(k <= vorige + 1e-9, `monotoon bij ${bedrag}`); vorige = k;
  }
  // Eerder inkomen = minder kapitaal
  ok(
    benodigdUitReeks(gatReeks(3000, [B('P', 800, 62)], 60, 30), 10) <
      benodigdUitReeks(gatReeks(3000, [B('P', 800, 70)], 60, 30), 10),
    'eerder inkomen = minder nodig',
  );
}

// 7. Fases kloppen met de reeks
{
  const br = [B('Overig', 600, 62), B('AOW', 1300, 67), B('Pensioen', 700, 70)];
  const fases = fasesUitReeks(3500, br, 60, 30);
  ok(fases.length === 4, `4 fases, kreeg ${fases.length}`);
  const verwacht = [[60, 62, 0, 3500], [62, 67, 600, 2900], [67, 70, 1900, 1600], [70, 90, 2600, 900]];
  fases.forEach((f, i) => {
    near(f.vanLeeftijd, verwacht[i][0], 1e-9, `fase ${i} van`);
    near(f.totLeeftijd, verwacht[i][1], 1e-9, `fase ${i} tot`);
    near(f.inkomen, verwacht[i][2], 1e-9, `fase ${i} inkomen`);
    near(f.gat, verwacht[i][3], 1e-9, `fase ${i} gat`);
  });
  // Inkomen groter dan uitgaven: inkomen wordt volledig getoond, gat 0
  const f2 = fasesUitReeks(1000, [B('AOW', 1400, 67)], 60, 30);
  near(f2[1].inkomen, 1400, 1e-9, 'inkomen boven uitgaven'); near(f2[1].gat, 0, 1e-9, 'gat 0');
  // Geen inkomen: 1 fase
  ok(fasesUitReeks(3000, [], 60, 30).length === 1, '1 fase zonder inkomen');
}

console.log(`${checks} checks, ${fails} mislukt`);
process.exit(fails ? 1 : 0);
