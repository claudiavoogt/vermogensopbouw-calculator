import { NextRequest, NextResponse } from 'next/server';
import {
  fvSeries,
  inflFactor,
  fasesUitReeks,
  berekenScenario,
  bepaalOordeel,
  type InkomenBron,
  type ScenarioInvoer,
  type ScenarioUitkomst,
} from '../../lib/rekenkunde';

const INFLATIE_DEFAULT = 2;
const RATES = [7, 10, 12];

// Maakt van de aanvraag een schone lijst met ander inkomen (AOW, pensioen, overig).
function leesInkomen(raw: unknown, startLeeftijd: number): InkomenBron[] {
  if (!Array.isArray(raw)) return [];
  const bronnen: InkomenBron[] = [];
  for (const item of raw.slice(0, 10)) {
    const bedrag = Math.min(100000, Math.max(0, Number(item?.bedrag) || 0));
    if (bedrag <= 0) continue;
    const leeftijdRaw = Number(item?.vanafLeeftijd);
    const vanafLeeftijd = Number.isFinite(leeftijdRaw) && leeftijdRaw > 0 ? Math.min(120, leeftijdRaw) : startLeeftijd;
    bronnen.push({ naam: String(item?.naam ?? '').slice(0, 30), bedrag, vanafLeeftijd });
  }
  return bronnen;
}

export async function POST(request: NextRequest) {
  try {
    const b = await request.json();
    const startbedrag = Math.max(0, Number(b.startbedrag) || 0);
    const maandinleg = Math.max(0, Number(b.maandinleg) || 0);
    const maanduitgaven = Math.max(0, Number(b.maanduitgaven) || 0);
    const opbouwjaren = Math.max(0, Number(b.opbouwjaren) || 0);
    const onttrekkingsjaren = Math.max(0, Number(b.onttrekkingsjaren) || 0);
    const beschikbaarLeeftijd = Math.max(0, Number(b.beschikbaarLeeftijd) || 0);
    const geenPensioen = !!b.geenPensioen;
    const inflatieRaw = Number(b.inflatie);
    const inflatie = Number.isFinite(inflatieRaw) ? Math.max(0, Math.min(10, inflatieRaw)) : INFLATIE_DEFAULT;

    // Ander inkomen telt alleen mee als je vermogen ook echt als pensioen gebruikt wordt.
    const bronnen = geenPensioen ? [] : leesInkomen(b.inkomen, beschikbaarLeeftijd);
    const heeftInkomen = bronnen.length > 0;
    const ijkLeeftijd = geenPensioen ? beschikbaarLeeftijd : beschikbaarLeeftijd + onttrekkingsjaren;

    const invoer: ScenarioInvoer = {
      startbedrag,
      maandinleg,
      maanduitgaven: geenPensioen ? 0 : maanduitgaven,
      opbouwjaren,
      beschikbaarLeeftijd,
      ijkLeeftijd,
      bronnen,
    };

    // Per rendement twee varianten: zonder inflatie (referentie) en met de gekozen inflatie.
    const scenarios: Record<number, { zonder: ScenarioUitkomst; met: ScenarioUitkomst }> = {};
    RATES.forEach((rt) => {
      scenarios[rt] = {
        zonder: berekenScenario(invoer, rt, 0),
        met: berekenScenario(invoer, rt, inflatie),
      };
    });

    const oordeel = geenPensioen ? null : bepaalOordeel(scenarios[7].met, scenarios[10].met, ijkLeeftijd);

    // Opbouw in nominale euro's (stap 3) en de grafiek
    const eind: Record<number, number> = {};
    RATES.forEach((rt) => (eind[rt] = fvSeries(startbedrag, maandinleg, rt, opbouwjaren)));
    const totaalIngelegd = startbedrag + maandinleg * opbouwjaren * 12;
    const labels = Array.from({ length: Math.floor(opbouwjaren) + 1 }, (_, i) => i);
    const chart = {
      labels,
      series: RATES.map((rt) => ({ rate: rt, data: labels.map((y) => fvSeries(startbedrag, maandinleg, rt, y)) })),
    };

    const fInfl = inflFactor(inflatie, opbouwjaren);
    const fases = geenPensioen ? [] : fasesUitReeks(maanduitgaven, bronnen, beschikbaarLeeftijd, onttrekkingsjaren);

    return NextResponse.json({
      eind,
      totaalIngelegd,
      chart,
      opbouwjaren,
      onttrekkingsjaren,
      beschikbaarLeeftijd,
      ijkLeeftijd,
      inflatie,
      fInfl,
      uitgavenNaInflatie: maanduitgaven * fInfl,
      heeftInkomen,
      fases,
      oordeel,
      scenarios,
    });
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
}
