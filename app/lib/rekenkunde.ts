// ---------- Pure rekenfuncties (server-side, niet zichtbaar in de client) ----------
// Alle bedragen die je invult (uitgaven, AOW, pensioen, overig) staan in euro's van nu, netto per maand.
// Het opgebouwde vermogen groeit in "nominale" euro's (wat je op je rekening ziet). Om appels met appels te
// vergelijken rekenen we het benodigde en het opgebouwde vermogen om naar koopkracht van nu.

export const r12 = (annual: number): number => annual / 100 / 12;

export function fvSeries(start: number, monthly: number, annual: number, years: number): number {
  if (years <= 0) return start;
  const r = r12(annual);
  const n = years * 12;
  const g = Math.pow(1 + r, n);
  return start * g + monthly * ((g - 1) / r);
}

// Benodigd kapitaal voor een vast maandbedrag zonder inflatie (gesloten formule, dient ook als controle).
export function benodigdKapitaal(monthly: number, annual: number, years: number): number {
  if (years <= 0 || monthly <= 0) return 0;
  const r = r12(annual);
  const m = years * 12;
  return (monthly * (1 - Math.pow(1 + r, -m))) / r;
}

// Maandelijkse inleg die nodig is om `target` te bereiken (target in euro's van het einde van de opbouw).
export function benodigdeInleg(target: number, start: number, annual: number, years: number): number {
  if (years <= 0) return 0;
  const r = r12(annual);
  const n = years * 12;
  const g = Math.pow(1 + r, n);
  const out = ((target - start * g) * r) / (g - 1);
  return out < 0 ? 0 : out;
}

export const inflFactor = (rate: number, years: number): number => Math.pow(1 + rate / 100, years);

// Reëel maandrendement: hoeveel je vermogen per maand in koopkracht groeit, na aftrek van de prijsstijging.
export function reeelMaandRendement(annual: number, inflatie: number): number {
  const r = r12(annual);
  const pim = Math.pow(1 + inflatie / 100, 1 / 12) - 1; // maandelijkse prijsstijging
  return (1 + r) / (1 + pim) - 1;
}

// ---------- Ander inkomen (AOW, pensioen, overig) ----------
export interface InkomenBron {
  naam: string;
  bedrag: number; // netto per maand, euro's van nu
  vanafLeeftijd: number; // ingangsleeftijd
}

export interface Fase {
  vanLeeftijd: number;
  totLeeftijd: number;
  inkomen: number; // som van het andere inkomen in deze fase
  gat: number; // wat uit vermogen moet komen (nooit onder 0)
}

const EPS = 1e-9;

// Het andere inkomen per maand van de onttrekkingsperiode.
// Maand t loopt van leeftijd (startLeeftijd + t/12) tot (startLeeftijd + (t+1)/12).
// Inkomen telt mee vanaf de maand waarin de ingangsleeftijd is bereikt.
export function inkomenReeks(bronnen: InkomenBron[], startLeeftijd: number, onttrekkingsjaren: number): number[] {
  const n = Math.max(0, Math.round(onttrekkingsjaren * 12));
  const out: number[] = [];
  for (let t = 0; t < n; t++) {
    const leeftijd = startLeeftijd + t / 12;
    let inkomen = 0;
    for (const b of bronnen) {
      if (b.bedrag > 0 && b.vanafLeeftijd <= leeftijd + EPS) inkomen += b.bedrag;
    }
    out.push(inkomen);
  }
  return out;
}

// Het maandelijkse gat uit vermogen: uitgaven min ander inkomen, nooit onder 0.
export function gatReeks(
  uitgaven: number,
  bronnen: InkomenBron[],
  startLeeftijd: number,
  onttrekkingsjaren: number,
): number[] {
  return inkomenReeks(bronnen, startLeeftijd, onttrekkingsjaren).map((i) => Math.max(0, uitgaven - i));
}

// Contante waarde (bij het begin van de onttrekking) van een reeks maandelijkse opnames zonder inflatie,
// telkens aan het einde van de maand opgenomen, zoals in benodigdKapitaal.
export function benodigdUitReeks(gaten: number[], annual: number): number {
  const r = r12(annual);
  let pv = 0;
  for (let t = 0; t < gaten.length; t++) pv += gaten[t] / Math.pow(1 + r, t + 1);
  return pv;
}

// Hoeveel kapitaal er na de laatste opname nog over is als je begint met `start` en elke maand `gaten[t]` opneemt.
// Bij precies het benodigde kapitaal hoort dit 0 te zijn. Wordt alleen gebruikt om te controleren.
export function restkapitaal(start: number, gaten: number[], annual: number): number {
  const r = r12(annual);
  let k = start;
  for (const g of gaten) k = k * (1 + r) - g;
  return k;
}

// Groepeert de maandreeks in aaneengesloten fases met hetzelfde inkomen, voor weergave.
export function fasesUitReeks(
  uitgaven: number,
  bronnen: InkomenBron[],
  startLeeftijd: number,
  onttrekkingsjaren: number,
): Fase[] {
  const inkomen = inkomenReeks(bronnen, startLeeftijd, onttrekkingsjaren);
  const fases: Fase[] = [];
  let begin = 0;
  for (let t = 1; t <= inkomen.length; t++) {
    if (t === inkomen.length || Math.abs(inkomen[t] - inkomen[begin]) > 1e-9) {
      fases.push({
        vanLeeftijd: startLeeftijd + begin / 12,
        totLeeftijd: startLeeftijd + t / 12,
        inkomen: inkomen[begin],
        gat: Math.max(0, uitgaven - inkomen[begin]),
      });
      begin = t;
    }
  }
  return fases;
}

// ---------- Scenario's: opbouw, benodigd vermogen, tot welke leeftijd gaat het geld mee ----------

// Tot deze leeftijd rekenen we door om te bepalen "tot wanneer gaat het geld mee". Daarboven tonen we "100+".
export const GELD_MAX_LEEFTIJD = 100;

export interface ScenarioInvoer {
  startbedrag: number;
  maandinleg: number;
  maanduitgaven: number; // euro's van nu
  opbouwjaren: number;
  beschikbaarLeeftijd: number; // start van de onttrekking
  ijkLeeftijd: number; // tot deze leeftijd wil je zeker zijn
  bronnen: InkomenBron[];
}

export interface ScenarioUitkomst {
  rendement: number; // % per jaar
  inflatie: number; // % per jaar (0 = zonder inflatie)
  vermogenNominaal: number; // op papier, wat je op je rekening ziet op de beschikbaar-leeftijd
  vermogen: number; // in koopkracht van nu
  nodig: number; // benodigd vermogen tot je ijkpunt, in koopkracht van nu
  buffer: number; // vermogen min nodig; negatief is een tekort
  geldTot: number; // leeftijd waarop het geld op is, begrensd op GELD_MAX_LEEFTIJD (of ijkpunt als dat hoger is)
  geldTotMax: boolean; // true: het geld ging mee tot de bovengrens van het onderzoek
  kanUitgeven: number; // maximaal maandbedrag (totaal, inclusief ander inkomen) tot je ijkpunt, koopkracht van nu
  inlegNodig: number; // maandelijkse inleg die nodig is om het ijkpunt te halen
  vierProcentPerMaand: number; // 4%-regel: duurzaam maandbedrag, koopkracht van nu
}

// Gat per maand tot en met de bovengrens van het onderzoek (zodat we kunnen bepalen wanneer het geld op is).
function gatTotHorizon(inv: ScenarioInvoer, uitgaven: number): number[] {
  const horizonLeeftijd = Math.max(GELD_MAX_LEEFTIJD, inv.ijkLeeftijd);
  const jaren = Math.max(0, horizonLeeftijd - inv.beschikbaarLeeftijd);
  return gatReeks(uitgaven, inv.bronnen, inv.beschikbaarLeeftijd, jaren);
}

// Contante waarde in koopkracht van nu van de eerste `maanden` maanden aan opnames (gaten in euro's van nu).
function nodigReeel(gaten: number[], maanden: number, rr: number): number {
  let pv = 0;
  const n = Math.min(maanden, gaten.length);
  for (let t = 0; t < n; t++) pv += gaten[t] / Math.pow(1 + rr, t + 1);
  return pv;
}

// Eerste maand waarin het kapitaal niet meer toereikend is. Geeft het aantal volledig betaalde maanden terug.
function volledigBetaaldeMaanden(kapitaal: number, gaten: number[], rr: number): { maanden: number; nooitOp: boolean } {
  let k = kapitaal;
  for (let t = 0; t < gaten.length; t++) {
    k = k * (1 + rr) - gaten[t];
    if (k < -EPS * Math.max(1, kapitaal)) return { maanden: t, nooitOp: false };
  }
  return { maanden: gaten.length, nooitOp: true };
}

export function berekenScenario(inv: ScenarioInvoer, rendement: number, inflatie: number): ScenarioUitkomst {
  const f = inflFactor(inflatie, inv.opbouwjaren); // prijsstijging tijdens de opbouw
  const rr = reeelMaandRendement(rendement, inflatie);
  const vermogenNominaal = fvSeries(inv.startbedrag, inv.maandinleg, rendement, inv.opbouwjaren);
  const vermogen = vermogenNominaal / f;

  const ijkMaanden = Math.max(0, Math.round((inv.ijkLeeftijd - inv.beschikbaarLeeftijd) * 12));
  const gaten = gatTotHorizon(inv, inv.maanduitgaven);
  const nodig = nodigReeel(gaten, ijkMaanden, rr);

  const betaald = volledigBetaaldeMaanden(vermogen, gaten, rr);
  const geldTot = inv.beschikbaarLeeftijd + betaald.maanden / 12;

  // Wat kun je uitgeven: het grootste totaalbedrag waarvan het benodigde vermogen niet boven je vermogen komt.
  let laag = 0;
  let hoog = 1e7;
  for (let i = 0; i < 80; i++) {
    const midden = (laag + hoog) / 2;
    const nodigMidden = nodigReeel(gatTotHorizon(inv, midden), ijkMaanden, rr);
    if (nodigMidden <= vermogen) laag = midden;
    else hoog = midden;
  }
  const kanUitgeven = laag;

  // Inleg die nodig is: zorg dat het opgebouwde vermogen op de beschikbaar-leeftijd (nominaal) gelijk is aan wat je
  // nodig hebt (koopkracht) maal de prijsstijging tijdens de opbouw.
  const inlegNodig = benodigdeInleg(nodig * f, inv.startbedrag, rendement, inv.opbouwjaren);

  return {
    rendement,
    inflatie,
    vermogenNominaal,
    vermogen,
    nodig,
    buffer: vermogen - nodig,
    geldTot,
    geldTotMax: betaald.nooitOp,
    kanUitgeven,
    inlegNodig,
    vierProcentPerMaand: (vermogen * 0.04) / 12,
  };
}

export type Oordeel = 'groen' | 'oranje' | 'rood';

// Groen: het geld haalt je ijkpunt, ook bij tegenvallend rendement (matig).
// Oranje: alleen in het verwachte scenario. Rood: ook in het verwachte scenario niet.
export function bepaalOordeel(matig: ScenarioUitkomst, verwacht: ScenarioUitkomst, ijkLeeftijd: number): Oordeel {
  const haalt = (s: ScenarioUitkomst) => s.geldTot >= ijkLeeftijd - EPS;
  if (haalt(matig) && haalt(verwacht)) return 'groen';
  if (haalt(verwacht)) return 'oranje';
  return 'rood';
}
