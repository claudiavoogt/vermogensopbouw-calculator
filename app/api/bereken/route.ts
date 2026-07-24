import { NextRequest, NextResponse } from 'next/server';

// ---------- Pure rekenfuncties (server-side, niet zichtbaar in de client) ----------
const r12 = (annual: number): number => annual / 100 / 12;

function fvSeries(start: number, monthly: number, annual: number, years: number): number {
  if (years <= 0) return start;
  const r = r12(annual);
  const n = years * 12;
  const g = Math.pow(1 + r, n);
  return start * g + monthly * ((g - 1) / r);
}

function benodigdKapitaal(monthly: number, annual: number, years: number): number {
  if (years <= 0 || monthly <= 0) return 0;
  const r = r12(annual);
  const m = years * 12;
  return (monthly * (1 - Math.pow(1 + r, -m))) / r;
}

function benodigdeInleg(target: number, start: number, annual: number, years: number): number {
  if (years <= 0) return 0;
  const r = r12(annual);
  const n = years * 12;
  const g = Math.pow(1 + r, n);
  const out = ((target - start * g) * r) / (g - 1);
  return out < 0 ? 0 : out;
}

const inflFactor = (rate: number, years: number): number => Math.pow(1 + rate / 100, years);

const INFLATIE_DEFAULT = 2;
const RENDEMENT = 10;
const RATES = [7, 10, 12];

export async function POST(request: NextRequest) {
  try {
    const b = await request.json();
    const startbedrag = Math.max(0, Number(b.startbedrag) || 0);
    const maandinleg = Math.max(0, Number(b.maandinleg) || 0);
    const maanduitgaven = Math.max(0, Number(b.maanduitgaven) || 0);
    const opbouwjaren = Math.max(0, Number(b.opbouwjaren) || 0);
    const onttrekkingsjaren = Math.max(0, Number(b.onttrekkingsjaren) || 0);
    const geenPensioen = !!b.geenPensioen;
    const inflatieRaw = Number(b.inflatie);
    const inflatie = Number.isFinite(inflatieRaw) ? Math.max(0, Math.min(10, inflatieRaw)) : INFLATIE_DEFAULT;

    const eind: Record<number, number> = {};
    RATES.forEach((rt) => (eind[rt] = fvSeries(startbedrag, maandinleg, rt, opbouwjaren)));
    const nominaalEind = eind[RENDEMENT];
    const totaalIngelegd = startbedrag + maandinleg * opbouwjaren * 12;

    const benodigd: Record<number, number> = {};
    RATES.forEach((rt) => (benodigd[rt] = benodigdKapitaal(maanduitgaven, rt, onttrekkingsjaren)));
    const benodigdNominaal = geenPensioen ? 0 : benodigd[RENDEMENT];
    const buffer = nominaalEind - benodigdNominaal;

    const fInfl = inflFactor(inflatie, opbouwjaren);
    const reeelEind = nominaalEind / fInfl;
    const uitgavenNaInflatie = maanduitgaven * fInfl;
    const benodigdNaInflatie = benodigdNominaal * fInfl;

    const inlegInStandHouden = benodigdeInleg(nominaalEind * fInfl, startbedrag, RENDEMENT, opbouwjaren);
    const inlegLevenskosten = benodigdeInleg(benodigdNominaal, startbedrag, RENDEMENT, opbouwjaren);
    const inlegLevenskostenInflatie = benodigdeInleg(benodigdNaInflatie, startbedrag, RENDEMENT, opbouwjaren);

    const labels = Array.from({ length: opbouwjaren + 1 }, (_, i) => i);
    const chart = {
      labels,
      series: RATES.map((rt) => ({ rate: rt, data: labels.map((y) => fvSeries(startbedrag, maandinleg, rt, y)) })),
    };

    return NextResponse.json({
      eind,
      nominaalEind,
      totaalIngelegd,
      benodigd,
      benodigdNominaal,
      buffer,
      fInfl,
      inflatie,
      reeelEind,
      uitgavenNaInflatie,
      benodigdNaInflatie,
      inlegInStandHouden,
      inlegLevenskosten,
      inlegLevenskostenInflatie,
      chart,
      opbouwjaren,
      onttrekkingsjaren,
    });
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
}
