'use client';

import { useState, useRef, useEffect } from 'react';

// ---------- Types ----------
interface Scenario {
  naam: string;
  rate: number;
  kleur: string;
}
interface RowProps {
  k: string;
  v: string;
  last?: boolean;
  green?: boolean;
  red?: boolean;
}
interface Uitkomst {
  rendement: number;
  inflatie: number;
  vermogenNominaal: number;
  vermogen: number;
  nodig: number;
  buffer: number;
  geldTot: number;
  geldTotMax: boolean;
  kanUitgeven: number;
  inlegNodig: number;
  vierProcentPerMaand: number;
}
interface Paar {
  zonder: Uitkomst;
  met: Uitkomst;
}
interface Results {
  eind: Record<number, number>;
  totaalIngelegd: number;
  chart: { labels: number[]; series: { rate: number; data: number[] }[] };
  opbouwjaren: number;
  onttrekkingsjaren: number;
  beschikbaarLeeftijd: number;
  ijkLeeftijd: number;
  inflatie: number;
  fInfl: number;
  uitgavenNaInflatie: number;
  heeftInkomen: boolean;
  fases: { vanLeeftijd: number; totLeeftijd: number; inkomen: number; gat: number }[];
  oordeel: 'groen' | 'oranje' | 'rood' | null;
  scenarios: Record<number, Paar>;
}

// ---------- Rekenkunde draait server-side in app/api/bereken/route.ts ----------
const euro = (n: number): string =>
  '€ ' + new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const formatProcent = (n: number): string => n.toFixed(1).replace('.', ',') + '%';
// Leeftijd zonder onnodige decimalen: 67 blijft 67, 67,25 blijft 67,25
const formatLeeftijd = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');

const INFLATIE_DEFAULT = 2;
const RENDEMENT = 10;

const scenarios: Scenario[] = [
  { naam: 'Matig', rate: 7, kleur: '#8a8d99' },
  { naam: 'Verwacht', rate: RENDEMENT, kleur: '#6B2D84' },
  { naam: 'Optimistisch', rate: 12, kleur: '#3EDCB1' },
];

// ---------- Row ----------
function Row({ k, v, last, green, red }: RowProps) {
  const style = green ? { color: '#1a7a52' } : red ? { color: '#d63a1f' } : undefined;
  return (
    <div className={'vc-row' + (last ? ' last' : '')}>
      <span>{k}</span>
      <strong style={style}>{v}</strong>
    </div>
  );
}

// ---------- DuoRow: twee kolommen, zonder en met inflatie ----------
function DuoRow({ k, a, b, last, tone }: { k: string; a: string; b: string; last?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <div className={'vc-duo-row' + (last ? ' last' : '')}>
      <span className="k">{k}</span>
      <span className="a">{a}</span>
      <span className={'b' + (tone ? ' ' + tone : '')}>{b}</span>
    </div>
  );
}

// ---------- Page ----------
export default function VermogensopbouwCalculator() {
  const [step, setStep] = useState<number>(1);
  const [huidigeLeeftijd, setHuidigeLeeftijd] = useState<string>('');
  const [beschikbaarLeeftijd, setBeschikbaarLeeftijd] = useState<string>('');
  const [startbedrag, setStartbedrag] = useState<number>(0);
  const [maandinleg, setMaandinleg] = useState<number>(300);
  const [maanduitgaven, setMaanduitgaven] = useState<number>(3000);
  const [totLeeftijd, setTotLeeftijd] = useState<string>('');
  const [geenPensioen, setGeenPensioen] = useState<boolean>(false);
  // Ander inkomen op je pensioen: netto per maand in euro's van nu, plus de leeftijd waarop het ingaat
  const [aowBedrag, setAowBedrag] = useState<string>('');
  const [aowLeeftijd, setAowLeeftijd] = useState<string>('67');
  const [pensioenBedrag, setPensioenBedrag] = useState<string>('');
  const [pensioenLeeftijd, setPensioenLeeftijd] = useState<string>('67');
  const [overigBedrag, setOverigBedrag] = useState<string>('');
  const [overigLeeftijd, setOverigLeeftijd] = useState<string>('');
  const [inflatie, setInflatie] = useState<number>(INFLATIE_DEFAULT);
  const [error, setError] = useState<string>('');
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [gekozenRate, setGekozenRate] = useState<number>(RENDEMENT);
  const requestTeller = useRef<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<any>(null);

  // Google Fonts
  useEffect(() => {
    const id = 'vc-fonts';
    if (!document.getElementById(id)) {
      const l = document.createElement('link');
      l.id = id;
      l.rel = 'stylesheet';
      l.href =
        'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&family=Lora:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap';
      document.head.appendChild(l);
    }
  }, []);

  // ---------- Invoer-afgeleiden (alleen voor labels en de aanvraag) ----------
  const hl = parseFloat(huidigeLeeftijd) || 0;
  const bl = parseFloat(beschikbaarLeeftijd) || 0;
  const tl = parseFloat(totLeeftijd) || 0;
  const opbouwjaren = Math.max(0, bl - hl);
  const onttrekkingsjaren = Math.max(0, tl - bl);

  // Ander inkomen. Een lege leeftijd bij "overig" betekent: loopt al vanaf je beschikbaar-leeftijd.
  const inkomenBronnen = [
    { naam: 'AOW', bedrag: parseFloat(aowBedrag) || 0, vanafLeeftijd: parseFloat(aowLeeftijd) || 0 },
    { naam: 'Pensioen', bedrag: parseFloat(pensioenBedrag) || 0, vanafLeeftijd: parseFloat(pensioenLeeftijd) || 0 },
    { naam: 'Overig inkomen', bedrag: parseFloat(overigBedrag) || 0, vanafLeeftijd: parseFloat(overigLeeftijd) || bl },
  ].filter((b) => b.bedrag > 0);

  // ---------- Resultaten komen server-side terug uit de Netlify function ----------
  const leeg: Uitkomst = {
    rendement: 0, inflatie: 0, vermogenNominaal: 0, vermogen: 0, nodig: 0, buffer: 0,
    geldTot: 0, geldTotMax: false, kanUitgeven: 0, inlegNodig: 0, vierProcentPerMaand: 0,
  };
  const sc = (rt: number): Paar => results?.scenarios?.[rt] ?? { zonder: leeg, met: leeg };
  const verwacht = sc(RENDEMENT);
  const matig = sc(7);
  const gek = sc(gekozenRate);
  const gekozenNaam = scenarios.find((s) => s.rate === gekozenRate)?.naam ?? 'Verwacht';
  const eind = results?.eind ?? ({ 7: 0, 10: 0, 12: 0 } as Record<number, number>);
  const nominaalEind = eind[RENDEMENT] ?? 0;
  const totaalIngelegd = results?.totaalIngelegd ?? 0;
  const fInfl = results?.fInfl ?? 1;
  const uitgavenNaInflatie = results?.uitgavenNaInflatie ?? 0;
  const ijkLeeftijd = results?.ijkLeeftijd ?? 0;
  const oordeel = results?.oordeel ?? null;
  const heeftInkomen = results?.heeftInkomen ?? false;
  const fases = results?.fases ?? [];
  const inflatieImpact = geenPensioen ? gek.zonder.vermogen - gek.met.vermogen : gek.zonder.buffer - gek.met.buffer;

  // "Tot je 87e" of "Tot je 100+"
  const leeftijdTekst = (u: Uitkomst): string =>
    u.geldTotMax || u.geldTot >= 100 ? '100+' : String(Math.floor(u.geldTot + 1e-9)) + 'e';
  const bufferTekst = (b: number): string => (b >= 0 ? '+ ' + euro(b) : 'tekort ' + euro(-b));

  const fetchResults = async (override: Record<string, unknown> = {}, silent = false) => {
    const nummer = ++requestTeller.current;
    if (!silent) setLoading(true);
    try {
      const payload = {
        startbedrag,
        maandinleg,
        maanduitgaven,
        opbouwjaren: Math.max(0, bl - hl),
        onttrekkingsjaren: Math.max(0, tl - bl),
        beschikbaarLeeftijd: bl,
        inkomen: inkomenBronnen,
        geenPensioen,
        inflatie,
        ...override,
      };
      const res = await fetch('/api/bereken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as Results;
      if (!data?.scenarios) throw new Error('bad response');
      // Alleen het nieuwste antwoord telt (bij snel slepen van de schuif)
      if (nummer === requestTeller.current) setResults(data);
    } catch {
      if (nummer === requestTeller.current) setResults(null);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // ---------- Chart ----------
  useEffect(() => {
    if (step !== 3 || !results) return;
    let cancelled = false;
    const w = window as any;
    const draw = () => {
      if (cancelled || !canvasRef.current || !w.Chart || !results) return;
      if (chartRef.current) chartRef.current.destroy();
      const labels = results.chart.labels;
      const datasets = results.chart.series.map((serie) => {
        const sc = scenarios.find((s) => s.rate === serie.rate);
        return {
          label: `${sc?.naam ?? ''} (${serie.rate}%)`,
          data: serie.data,
          borderColor: sc?.kleur ?? '#6B2D84',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0.25,
        };
      });
      chartRef.current = new w.Chart(canvasRef.current, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {
                font: { family: 'Montserrat', size: 11 },
                color: '#1A1F36',
                usePointStyle: true,
                pointStyle: 'rectRounded',
              },
            },
            tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: ${euro(c.parsed.y)}` } },
          },
          scales: {
            x: { grid: { color: '#eee' }, ticks: { font: { family: 'Montserrat', size: 11 }, color: '#8a8d99' } },
            y: {
              grid: { color: '#eee' },
              ticks: {
                font: { family: 'Montserrat', size: 11 },
                color: '#8a8d99',
                callback: (v: number) =>
                  v >= 1000000 ? '€ ' + v / 1000000 + 'M' : v >= 1000 ? '€ ' + v / 1000 + 'k' : '€ ' + v,
              },
            },
          },
        },
      });
    };
    if (w.Chart) {
      draw();
    } else if (!document.getElementById('vc-chartjs')) {
      const sc = document.createElement('script');
      sc.id = 'vc-chartjs';
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
      sc.onload = draw;
      document.body.appendChild(sc);
    } else {
      const iv = setInterval(() => {
        if (w.Chart) {
          clearInterval(iv);
          draw();
        }
      }, 100);
    }
    return () => {
      cancelled = true;
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, results]);

  // ---------- Navigatie ----------
  const go = (n: number) => {
    setError('');
    setStep(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const next1 = () => {
    if (!hl || !bl) return setError('Vul beide leeftijden in.');
    if (bl <= hl) return setError('De beschikbaar-leeftijd moet hoger zijn dan je huidige leeftijd.');
    go(2);
  };
  const next4 = async (skip: boolean) => {
    setGeenPensioen(skip);
    if (!skip) {
      if (!tl) return setError('Vul in tot welke leeftijd het vermogen mee moet gaan.');
      if (tl <= bl) return setError('Die leeftijd moet hoger zijn dan je beschikbaar-leeftijd.');
      for (const b of inkomenBronnen) {
        if (!b.vanafLeeftijd) return setError(`Vul in vanaf welke leeftijd je ${b.naam} ontvangt, of laat het bedrag leeg.`);
        if (b.vanafLeeftijd >= tl)
          return setError(
            `${b.naam} gaat in op ${formatLeeftijd(b.vanafLeeftijd)} jaar, maar je vermogen hoeft maar tot ${formatLeeftijd(tl)} mee. Pas de leeftijd aan of laat het bedrag leeg.`,
          );
      }
    }
    await fetchResults({ geenPensioen: skip });
    go(5);
  };

  const printPdf = () => window.print();
  const vandaag = new Date().toLocaleDateString('nl-NL');

  const Progress = () => (
    <div className="vc-progress">
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <span key={i} className={i < step ? 'done' : i === step ? 'active' : 'todo'} />
      ))}
    </div>
  );

  const Foot = ({ text }: { text: string }) => <p className="vc-foot">{text}</p>;

  const ScenarioChips = () => (
    <div className="vc-chips">
      {scenarios.map((s) => (
        <button
          key={s.rate}
          className={'vc-chip' + (s.rate === gekozenRate ? ' on' : '')}
          onClick={() => setGekozenRate(s.rate)}
        >
          {s.naam} ({s.rate}%)
        </button>
      ))}
    </div>
  );

  return (
    <div className="vc-root">
      <style>{css}</style>

      <header className="vc-header">
        <div className="vc-eyebrow">JOUW FINANCIEEL PLAN</div>
        <h1>VERMOGENSOPBOUW CALCULATOR</h1>
        <p className="vc-sub">Bereken wat jouw vermogen doet als je vroeg begint. Stap voor stap.</p>
      </header>

      <main className="vc-main">
        <Progress />

        {[3, 5, 6, 7].includes(step) && (loading || !results) && (
          <p className="vc-loading">Even rekenen…</p>
        )}

        {step === 1 && (
          <section>
            <div className="vc-step">STAP 1 VAN 7</div>
            <h2>Wie ben jij?</h2>
            <p className="vc-desc">We beginnen met de basis, zodat we jouw situatie goed kunnen inschatten.</p>
            <label className="vc-label">HUIDIGE LEEFTIJD</label>
            <input
              className="vc-input"
              type="number"
              placeholder="bijv. 32"
              value={huidigeLeeftijd}
              onChange={(e) => setHuidigeLeeftijd(e.target.value)}
            />
            <label className="vc-label">OP WELKE LEEFTIJD MOET HET VERMOGEN BESCHIKBAAR ZIJN?</label>
            <input
              className="vc-input"
              type="number"
              placeholder="bijv. 55"
              value={beschikbaarLeeftijd}
              onChange={(e) => setBeschikbaarLeeftijd(e.target.value)}
            />
            {error && <p className="vc-error">{error}</p>}
            <div className="vc-btns vc-right">
              <button className="vc-btn-primary" onClick={next1}>
                VOLGENDE →
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <div className="vc-step">STAP 2 VAN 7</div>
            <h2>Hoeveel leg je in?</h2>
            <p className="vc-desc">
              Zelfs een klein bedrag kan over tijd enorm groeien. Dat is de kracht van vroeg beginnen.
            </p>
            <label className="vc-label">STARTBEDRAG (€) — OPTIONEEL</label>
            <input
              className="vc-input"
              type="number"
              value={startbedrag}
              onChange={(e) => setStartbedrag(Math.max(0, parseFloat(e.target.value) || 0))}
            />
            <p className="vc-hint">Vul hier het bedrag in dat je al aan beleggingen hebt opgebouwd volgens de methode van Claudia.</p>
            <label className="vc-label">MAANDELIJKSE INLEG (€)</label>
            <div className="vc-sliderrow">
              <input
                className="vc-slider"
                type="range"
                min="0"
                max="1000"
                step="10"
                value={maandinleg}
                onChange={(e) => setMaandinleg(parseFloat(e.target.value))}
              />
              <span className="vc-slidervalue">{euro(maandinleg)}</span>
            </div>
            <input
              className="vc-input"
              type="number"
              value={maandinleg}
              onChange={(e) => setMaandinleg(Math.max(0, parseFloat(e.target.value) || 0))}
            />
            <div className="vc-btns vc-between">
              <button className="vc-btn-back" onClick={() => go(1)}>
                ← TERUG
              </button>
              <button className="vc-btn-primary" onClick={async () => { await fetchResults(); go(3); }}>
                BEREKEN →
              </button>
            </div>
          </section>
        )}

        {step === 3 && results && !loading && (
          <section>
            <div className="vc-step">STAP 3 VAN 7 — JOUW OPBOUW</div>
            <h2>Jouw vermogen op {bl}-jarige leeftijd</h2>
            <p className="vc-desc">
              Over {opbouwjaren} jaar, bij {euro(maandinleg)} per maand.
            </p>
            <div className="vc-cards3">
              {scenarios.map((s) => (
                <div key={s.rate} className={'vc-card' + (s.rate === RENDEMENT ? ' hl' : '')}>
                  <div className="vc-card-label">{s.naam.toUpperCase()} SCENARIO</div>
                  <div className="vc-card-rate" style={{ color: '#3EDCB1' }}>
                    {s.rate}% per jaar
                  </div>
                  <div className="vc-card-num">{euro(eind[s.rate])}</div>
                  <div className="vc-card-note">waarvan {euro(totaalIngelegd)} ingelegd</div>
                </div>
              ))}
            </div>
            <div className="vc-table">
              <Row k="Totaal ingelegd" v={euro(totaalIngelegd)} />
              <Row k="Verwachte groei" v={euro(nominaalEind - totaalIngelegd)} />
              <Row k="Looptijd" v={`${opbouwjaren} jaar`} />
              <Row k="Maandelijkse inleg" v={euro(maandinleg)} last />
            </div>
            <div className="vc-chartwrap">
              <canvas ref={canvasRef} />
            </div>
            <Foot text="Berekening op basis van bruto rendement, zonder box 3 belasting." />
            <div className="vc-cta">
              <div>
                <h3>En hoeveel heb je nodig?</h3>
                <p>Bereken wat je maandelijks nodig hebt om financieel vrij te leven.</p>
              </div>
              <button className="vc-btn-primary" onClick={() => go(4)}>
                VOLGENDE →
              </button>
            </div>
            <div className="vc-btns">
              <button className="vc-btn-back" onClick={() => go(2)}>
                ← AANPASSEN
              </button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section>
            <div className="vc-step">STAP 4 VAN 7 — WAT HEB JE NODIG?</div>
            <h2>Hoeveel wil je per maand uitgeven?</h2>
            <p className="vc-desc">
              Denk aan vaste lasten, boodschappen, vakanties, alles erbij. Wat heb je netto per maand nodig om
              comfortabel te leven?
            </p>
            <label className="vc-label">GEWENST NETTO MAANDBEDRAG (€)</label>
            <div className="vc-sliderrow">
              <input
                className="vc-slider"
                type="range"
                min="0"
                max="10000"
                step="100"
                value={maanduitgaven}
                onChange={(e) => setMaanduitgaven(parseFloat(e.target.value))}
              />
              <span className="vc-slidervalue">{euro(maanduitgaven)}</span>
            </div>
            <input
              className="vc-input"
              type="number"
              value={maanduitgaven}
              onChange={(e) => setMaanduitgaven(Math.max(0, parseFloat(e.target.value) || 0))}
            />
            <label className="vc-label">
              Je wilt het vermogen beschikbaar hebben op je {bl ? bl + 'e' : '…'}. Tot welke leeftijd wil je in elk geval zeker zijn dat het geld meegaat?
            </label>
            <input
              className="vc-input"
              type="number"
              placeholder="bijv. 85"
              value={totLeeftijd}
              onChange={(e) => setTotLeeftijd(e.target.value)}
            />
            <p className="vc-hint">Dit is jouw doelleeftijd, geen einddatum. We laten je straks zien tot welke leeftijd je geld écht meegaat.</p>

            <div className="vc-inkomen">
              <div className="vc-inkomen-titel">ANDER INKOMEN OP JE PENSIOEN (OPTIONEEL)</div>
              <p className="vc-inkomen-uitleg">
                Krijg je later AOW, pensioen of andere inkomsten? Dan hoef je alleen het <strong>verschil</strong> uit je
                vermogen te halen. Vul per regel het <strong>netto</strong> bedrag per maand in en vanaf welke leeftijd het
                ingaat. Laat leeg wat niet voor jou geldt.
              </p>
              {[
                {
                  naam: 'AOW',
                  bedrag: aowBedrag,
                  setBedrag: setAowBedrag,
                  leeftijd: aowLeeftijd,
                  setLeeftijd: setAowLeeftijd,
                  ph: '67',
                  hint: (
                    <>
                      Je AOW-bedrag en -leeftijd vind je op{' '}
                      <a href="https://www.svb.nl/nl/aow/bedragen-aow/aow-bedragen" target="_blank" rel="noopener noreferrer">
                        svb.nl
                      </a>
                      .
                    </>
                  ),
                },
                {
                  naam: 'PENSIOEN',
                  bedrag: pensioenBedrag,
                  setBedrag: setPensioenBedrag,
                  leeftijd: pensioenLeeftijd,
                  setLeeftijd: setPensioenLeeftijd,
                  ph: '67',
                  hint: (
                    <>
                      Werkgeverspensioen, lijfrente of eigen pensioen. Kijk op{' '}
                      <a href="https://www.mijnpensioenoverzicht.nl" target="_blank" rel="noopener noreferrer">
                        mijnpensioenoverzicht.nl
                      </a>
                      .
                    </>
                  ),
                },
                {
                  naam: 'OVERIG',
                  bedrag: overigBedrag,
                  setBedrag: setOverigBedrag,
                  leeftijd: overigLeeftijd,
                  setLeeftijd: setOverigLeeftijd,
                  ph: bl ? String(bl) : 'nu',
                  hint: <>Bijvoorbeeld huurinkomsten of dividend. Leeg = vanaf de leeftijd waarop je vermogen beschikbaar is.</>,
                },
              ].map((r) => (
                <div key={r.naam} className="vc-inkrow">
                  <div className="vc-inkname">{r.naam}</div>
                  <div className="vc-inkfields">
                    <div>
                      <span className="vc-inkmini">NETTO PER MAAND (€)</span>
                      <input
                        className="vc-input"
                        type="number"
                        min="0"
                        step="50"
                        placeholder="0"
                        value={r.bedrag}
                        onChange={(e) => r.setBedrag(e.target.value)}
                      />
                    </div>
                    <div>
                      <span className="vc-inkmini">VANAF LEEFTIJD</span>
                      <input
                        className="vc-input"
                        type="number"
                        min="0"
                        step="0.25"
                        placeholder={r.ph}
                        value={r.leeftijd}
                        onChange={(e) => r.setLeeftijd(e.target.value)}
                      />
                    </div>
                  </div>
                  <p className="vc-inkhint">{r.hint}</p>
                </div>
              ))}
              <p className="vc-inkhint">
                We rekenen met vaste bedragen in prijzen van nu, zonder indexatie en zonder belasting. Vul dus netto in, wat
                je maandelijks écht ontvangt.
              </p>
            </div>
            {error && <p className="vc-error">{error}</p>}
            <div className="vc-skipnote">
              Gebruik je je beleggingsvermogen <strong>niet</strong> als pensioen? Klik dan op <strong>Overslaan</strong>. Je
              ziet dan alleen je vermogensopbouw, zonder berekening van wat je nodig hebt om van te leven.
            </div>
            <div className="vc-btns vc-between">
              <button className="vc-btn-back" onClick={() => go(3)}>
                ← TERUG
              </button>
              <div className="vc-btngroup">
                <button className="vc-btn-ghost" onClick={() => next4(true)}>
                  OVERSLAAN →
                </button>
                <button className="vc-btn-primary" onClick={() => next4(false)}>
                  BEKIJK TOTAAL →
                </button>
              </div>
            </div>
          </section>
        )}

        {step === 5 && results && !loading && (
          <section>
            <div className="vc-step">STAP 5 VAN 7 — BEN JE OP KOERS?</div>
            <h2>Ben je op koers?</h2>
            <p className="vc-desc">
              Op basis van {euro(maandinleg)} per maand inleggen
              {geenPensioen
                ? '.'
                : ` en ${euro(maanduitgaven)} per maand uitgeven${
                    heeftInkomen ? ', waarvan een deel uit AOW, pensioen of ander inkomen komt' : ''
                  }, met als doelleeftijd je ${formatLeeftijd(ijkLeeftijd)}e.`}{' '}
              Alle bedragen staan in prijzen van nu: wat je er straks nog voor kunt kopen.
            </p>

            <label className="vc-label">INFLATIE PER JAAR</label>
            <div className="vc-sliderrow">
              <input
                className="vc-slider"
                type="range"
                min="0"
                max="10"
                step="0.5"
                value={inflatie}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setInflatie(v);
                  fetchResults({ inflatie: v }, true);
                }}
              />
              <span className="vc-slidervalue">{formatProcent(inflatie)}</span>
            </div>
            <p className="vc-hint">
              Historisch gemiddelde EU-inflatie: ±2–3%. In 2022 liep het op tot 10%+. Sleep de schuif en zie wat inflatie met
              je geld doet.
              {!geenPensioen &&
                ` Bij ${formatProcent(inflatie)} inflatie kost hetzelfde leven op je ${formatLeeftijd(bl)}e ${euro(
                  uitgavenNaInflatie,
                )} per maand in plaats van ${euro(maanduitgaven)}.`}
            </p>

            {!geenPensioen && oordeel && (
              <div className={'vc-banner ' + (oordeel === 'groen' ? 'good' : oordeel === 'oranje' ? 'warn' : 'bad')}>
                <div className="vc-banner-label">
                  {oordeel === 'groen' ? 'JE BENT OP KOERS' : oordeel === 'oranje' ? 'HET IS KRAP' : 'JE KOMT TEKORT'}
                </div>
                <div className="vc-banner-num">Tot je {leeftijdTekst(verwacht.met)}</div>
                <div className="vc-banner-sub">
                  {oordeel === 'groen' &&
                    `Je geld gaat mee tot je ${formatLeeftijd(ijkLeeftijd)}e, ook als het rendement tegenvalt (matig scenario: tot je ${leeftijdTekst(
                      matig.met,
                    )}).`}
                  {oordeel === 'oranje' &&
                    `Bij het verwachte rendement haal je je ${formatLeeftijd(
                      ijkLeeftijd,
                    )}e. Valt het rendement tegen (matig scenario), dan is je geld op, op je ${leeftijdTekst(matig.met)}.`}
                  {oordeel === 'rood' &&
                    `Zelfs bij het verwachte rendement is je geld op, op je ${leeftijdTekst(verwacht.met)}, terwijl je doelleeftijd ${formatLeeftijd(
                      ijkLeeftijd,
                    )} is. Bij tegenvallend rendement is het op, op je ${leeftijdTekst(matig.met)}.`}
                </div>
              </div>
            )}

            <h4 className="vc-h4">{geenPensioen ? 'JOUW VERMOGEN PER SCENARIO' : 'GELD GAAT MEE TOT, PER SCENARIO'}</h4>
            <p className="vc-hint" style={{ marginTop: 0, marginBottom: 12 }}>
              Kies een scenario om de details hieronder te zien.
            </p>
            <div className="vc-cards3">
              {scenarios.map((s) => (
                <div
                  key={s.rate}
                  role="button"
                  tabIndex={0}
                  className={'vc-card mini clickable' + (s.rate === gekozenRate ? ' hl' : '')}
                  onClick={() => setGekozenRate(s.rate)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setGekozenRate(s.rate);
                  }}
                >
                  <div className="vc-card-label">{s.naam.toUpperCase()} SCENARIO</div>
                  <div className="vc-card-rate" style={{ color: '#3EDCB1' }}>
                    {s.rate}% per jaar
                  </div>
                  <div className="vc-card-num small">
                    {geenPensioen ? euro(sc(s.rate).met.vermogen) : `Tot je ${leeftijdTekst(sc(s.rate).met)}`}
                  </div>
                  <div className="vc-card-note">
                    {geenPensioen ? "in prijzen van nu" : `${formatLeeftijd(ijkLeeftijd)}e was je doelleeftijd`}
                  </div>
                </div>
              ))}
            </div>

            <h4 className="vc-h4">
              {gekozenNaam.toUpperCase()} SCENARIO ({gekozenRate}%): ZONDER EN MET INFLATIE
            </h4>
            <div className="vc-duo">
              <div className="vc-duo-head">
                <span />
                <span>ALS PRIJZEN NIET STIJGEN</span>
                <span className="met">MET {formatProcent(inflatie)} INFLATIE</span>
              </div>
              <DuoRow k={`Jouw vermogen op je ${formatLeeftijd(bl)}e`} a={euro(gek.zonder.vermogen)} b={euro(gek.met.vermogen)} last={geenPensioen} />
              {!geenPensioen && (
                <>
                  <DuoRow k={`Nodig tot je ${formatLeeftijd(ijkLeeftijd)}e`} a={euro(gek.zonder.nodig)} b={euro(gek.met.nodig)} />
                  <DuoRow
                    k="Buffer of tekort"
                    a={bufferTekst(gek.zonder.buffer)}
                    b={bufferTekst(gek.met.buffer)}
                    tone={gek.met.buffer >= 0 ? 'good' : 'bad'}
                  />
                  <DuoRow
                    k="Geld gaat mee tot"
                    a={`je ${leeftijdTekst(gek.zonder)}`}
                    b={`je ${leeftijdTekst(gek.met)}`}
                    last
                  />
                </>
              )}
            </div>
            {inflatieImpact > 0.5 && !geenPensioen && (
              <p className="vc-impact">
                Door {formatProcent(inflatie)} inflatie heb je <strong>{euro(inflatieImpact)}</strong> minder ruimte.
              </p>
            )}
            {inflatieImpact > 0.5 && geenPensioen && (
              <p className="vc-impact">
                Door {formatProcent(inflatie)} inflatie is je vermogen <strong>{euro(gek.zonder.vermogen - gek.met.vermogen)}</strong>{' '}
                minder waard.
              </p>
            )}

            {!geenPensioen && (
              <div className="vc-wel">
                <div className="vc-wel-titel">DIT KUN JE WÉL</div>
                <p>
                  Met dit vermogen kun je tot je {formatLeeftijd(ijkLeeftijd)}e ongeveer <strong>{euro(verwacht.met.kanUitgeven)}</strong> per
                  maand uitgeven in het verwachte scenario, en <strong>{euro(matig.met.kanUitgeven)}</strong> als het rendement tegenvalt
                  {heeftInkomen ? ' (inclusief je AOW, pensioen en ander inkomen)' : ''}.
                </p>
                <p>
                  {verwacht.met.inlegNodig <= maandinleg + 0.005
                    ? `Voor ${euro(maanduitgaven)} per maand haal je je doelleeftijd in het verwachte scenario al met je huidige inleg.`
                    : `Voor ${euro(maanduitgaven)} per maand heb je in het verwachte scenario ${euro(
                        verwacht.met.inlegNodig,
                      )} per maand inleg nodig. Nu leg je ${euro(maandinleg)} in. Zie stap 7.`}
                </p>
              </div>
            )}

            <details className="vc-details">
              <summary>Bekijk de berekening</summary>
              <p className="vc-hint" style={{ marginTop: 0, marginBottom: 12 }}>
                We rekenen in <strong>prijzen van nu</strong>: wat je nu voor een bedrag kunt kopen, kun je dat later ook nog. De
                hogere prijzen door inflatie zie je terug bij <strong>prijzen van dan</strong>.
              </p>
              <div className="vc-table">
                <Row k="Opbouwperiode" v={`${formatLeeftijd(opbouwjaren)} jaar`} />
                {!geenPensioen && (
                  <Row k="Onttrekkingsperiode tot je doelleeftijd" v={`${formatLeeftijd(onttrekkingsjaren)} jaar (${formatLeeftijd(bl)} tot ${formatLeeftijd(ijkLeeftijd)})`} />
                )}
                <Row k="Opgebouwd (zonder inflatie)" v={euro(gek.zonder.vermogenNominaal)} />
                <Row k="Inflatie" v={`${formatProcent(inflatie)} per jaar`} />
                <Row k="Opgebouwd, in prijzen van nu" v={euro(gek.met.vermogen)} last={geenPensioen} />
                {!geenPensioen && <Row k="Gewenste uitgaven (prijzen van nu)" v={`${euro(maanduitgaven)} per maand`} />}
                {!geenPensioen && <Row k={`Hetzelfde leven kost op je ${formatLeeftijd(bl)}e (prijzen van dan, inflatie)`} v={`${euro(uitgavenNaInflatie)} per maand`} last={!heeftInkomen} />}
                {!geenPensioen &&
                  heeftInkomen &&
                  fases.map((f, i) => (
                    <Row
                      key={i}
                      k={`Uit vermogen, ${formatLeeftijd(f.vanLeeftijd)} tot ${formatLeeftijd(f.totLeeftijd)} jaar (prijzen van nu)`}
                      v={`${euro(f.gat)} per maand`}
                      last={i === fases.length - 1}
                    />
                  ))}
              </div>
            </details>

            <Foot text={`Berekening op basis van bruto rendement, zonder kosten en box 3 belasting. Uitgaven, AOW en pensioen zijn vaste bedragen in prijzen van nu. Inflatie: ${formatProcent(inflatie)} per jaar. Dit is geen beleggingsadvies.`} />
            <div className="vc-cta">
              <div>
                <h3>Wat kun je hier straks mee opnemen?</h3>
                <p>Bereken hoeveel je maandelijks van dit vermogen kunt opnemen, zonder dat het opraakt.</p>
              </div>
              <button className="vc-btn-primary" onClick={() => go(6)}>
                BEKIJK JE OPNAME →
              </button>
            </div>
            <div className="vc-btns">
              <button className="vc-btn-back" onClick={() => go(4)}>
                ← AANPASSEN
              </button>
            </div>
          </section>
        )}

        {step === 6 && results && !loading && (
          <section>
            <div className="vc-step">STAP 6 VAN 7 — WAT KUN JE OPNEMEN</div>
            <h2>Hoeveel zou je per maand kunnen opnemen?</h2>
            <p className="vc-desc">
              Beleggers gebruiken al jaren de <strong>4%-regel</strong>: een vuistregel die zegt{' '}
              <strong style={{ color: '#E21B70' }}>
                hoeveel je jaarlijks van je opgebouwde vermogen kunt opnemen zonder dat het ooit opraakt
              </strong>
              . Dit is wat dat betekent voor jouw
              vermogen, op je {formatLeeftijd(bl)}e. Alle bedragen in prijzen van nu.
            </p>
            <ScenarioChips />
            <div className="vc-duo">
              <div className="vc-duo-head">
                <span />
                <span>ALS PRIJZEN NIET STIJGEN</span>
                <span className="met">MET {formatProcent(inflatie)} INFLATIE</span>
              </div>
              <DuoRow k={`Opgebouwd vermogen op je ${formatLeeftijd(bl)}e`} a={euro(gek.zonder.vermogen)} b={euro(gek.met.vermogen)} />
              <DuoRow
                k="Levenslange opname per maand"
                a={euro(gek.zonder.vierProcentPerMaand)}
                b={euro(gek.met.vierProcentPerMaand)}
                last
              />
            </div>
            <Foot text="De 4%-regel is een vuistregel, geen garantie. De werkelijke uitkomst hangt af van rendement, inflatie en hoe lang het kapitaal moet meegaan. Dit is geen beleggingsadvies." />
            <div className="vc-cta">
              <div>
                <h3>Wat moet jij extra inleggen?</h3>
                <p>Bereken welke maandelijkse inleg je nodig hebt om je doelen te halen.</p>
              </div>
              <button className="vc-btn-primary" onClick={() => go(7)}>
                BEREKEN INLEG →
              </button>
            </div>
            <div className="vc-btns">
              <button className="vc-btn-back" onClick={() => go(5)}>
                ← TERUG
              </button>
            </div>
          </section>
        )}

        {step === 7 && results && !loading && (
          <section>
            <div className="vc-step">STAP 7 VAN 7 — BENODIGDE INLEG</div>
            <h2>Wat moet je inleggen?</h2>
            {geenPensioen ? (
              <div className="vc-goal">
                <div className="vc-goal-titel">Eerst je gewenste uitgaven invullen</div>
                <div className="vc-goal-uitleg">
                  Je hebt stap 4 overgeslagen, dus we weten niet wat je later nodig hebt. Vul je gewenste maandbedrag in, dan
                  rekenen we uit wat je daarvoor moet inleggen.
                </div>
                <button className="vc-btn-primary" onClick={() => go(4)}>
                  NAAR STAP 4 →
                </button>
              </div>
            ) : (
              <>
                <p className="vc-desc">
                  Dit is wat je per maand zou moeten inleggen om je geld te laten meegaan tot je {formatLeeftijd(ijkLeeftijd)}e, bij{' '}
                  {euro(maanduitgaven)} per maand aan uitgaven. We zetten het naast wat je nu inlegt, zodat je het verschil meteen
                  ziet.
                </p>

                <div className="vc-nowbar">
                  <span>JE LEGT NU IN</span>
                  <strong>
                    {euro(maandinleg)}
                    <small> per maand</small>
                  </strong>
                </div>

                {[
                  {
                    titel: `Je geld gaat mee tot je ${formatLeeftijd(ijkLeeftijd)}e`,
                    uitleg: 'Bij het verwachte rendement (10% per jaar).',
                    s: verwacht,
                  },
                  {
                    titel: 'Ook als het rendement tegenvalt',
                    uitleg: 'Bij het matige rendement (7% per jaar). Dit is de veilige variant.',
                    s: matig,
                  },
                ].map((g, i) => {
                  const verschil = maandinleg - g.s.met.inlegNodig;
                  const haalbaar = verschil >= -0.005;
                  return (
                    <div key={i} className={'vc-goal ' + (haalbaar ? 'ok' : 'tekort')}>
                      <div className="vc-goal-titel">{g.titel}</div>
                      <div className="vc-goal-uitleg">{g.uitleg}</div>
                      <div className="vc-duo flat">
                        <div className="vc-duo-head">
                          <span />
                          <span>ALS PRIJZEN NIET STIJGEN</span>
                          <span className="met">MET {formatProcent(inflatie)} INFLATIE</span>
                        </div>
                        <DuoRow k="Hiervoor heb je nodig" a={euro(g.s.zonder.nodig)} b={euro(g.s.met.nodig)} />
                        <DuoRow k="Inleg per maand" a={euro(g.s.zonder.inlegNodig)} b={euro(g.s.met.inlegNodig)} last />
                      </div>
                      <div className={'vc-goal-verdict ' + (haalbaar ? 'ok' : 'tekort')}>
                        {haalbaar
                          ? `Dit haal je al met je huidige inleg. Je houdt ${euro(Math.max(0, verschil))} per maand over.`
                          : `Hiervoor heb je ${euro(-verschil)} per maand extra nodig dan je nu inlegt.`}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            <Foot
              text={`Berekening op basis van bruto rendement, zonder kosten en box 3 belasting. Inflatie: ${formatProcent(inflatie)} per jaar. De inleg is een vast bedrag per maand. Dit is geen beleggingsadvies.`}
            />

            <div className="vc-pdfwrap">
              <button className="vc-btn-primary" onClick={printPdf}>
                OPSLAAN ALS PDF
              </button>
              <p className="vc-hint">Bestand → Afdrukken → Opslaan als PDF</p>
            </div>

            <div className="vc-quickedit">
              <div className="vc-quickedit-label">IETS AANPASSEN?</div>
              <div className="vc-quickedit-btns">
                <button className="vc-btn-quick" onClick={() => go(1)}>
                  ✏️ Leeftijd
                </button>
                <button className="vc-btn-quick" onClick={() => go(2)}>
                  ✏️ Inleg
                </button>
                <button className="vc-btn-quick" onClick={() => go(4)}>
                  ✏️ Uitgaven &amp; looptijd
                </button>
                <button className="vc-btn-quick" onClick={() => go(5)}>
                  ✏️ Inflatie
                </button>
              </div>
            </div>

            <div className="vc-btns">
              <button className="vc-btn-back" onClick={() => go(6)}>
                ← TERUG
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="vc-footer">
        <p className="vc-copy">
          <a href="https://claudiavoogt.nl" target="_blank" rel="noopener noreferrer" style={{ color: '#cdbcd9', textDecoration: 'underline' }}>
            claudiavoogt.nl
          </a>
          {' '}— Beleggingsexpert &amp; investeringsmentor
        </p>
        <p className="vc-copy" style={{ marginTop: 6, color: '#ffffff', opacity: 0.9, fontSize: 11, maxWidth: 600, margin: '6px auto 0' }}>
          © {new Date().getFullYear()} Claudia Voogt. Alle rechten voorbehouden. Deze tool mag niet worden gedeeld, gekopieerd, nagebouwd of hergebruikt zonder schriftelijke toestemming. Deze tool is een hulpmiddel, geen beleggingsadvies. De informatie is met zorg samengesteld, maar er kunnen geen rechten aan worden ontleend. Juistheid en volledigheid worden niet gegarandeerd.
        </p>
      </footer>

      {/* PDF-RAPPORT */}
      <div className="vc-report">
        <div className="vc-report-head">
          <div className="vc-eyebrow dark">JOUW FINANCIEEL PLAN</div>
          <h1>VERMOGENSOPBOUW CALCULATOR</h1>
          <p>Bereken wat jouw vermogen doet als je vroeg begint. Stap voor stap.</p>
        </div>
        <h2 className="vc-report-title">Jouw Vermogensplan — Generatie Fearless</h2>
        <p className="vc-report-date">Berekend op {vandaag}</p>

        <div className="vc-report-box">
          <div className="vc-report-boxtitle">JOUW GEGEVENS</div>
          <Row k="Huidige leeftijd" v={`${hl} jaar`} />
          <Row k="Gewenste pensioenleeftijd" v={`${bl} jaar`} />
          <Row k="Opbouwtijd" v={`${formatLeeftijd(opbouwjaren)} jaar`} />
          <Row k="Maandelijkse inleg" v={`${euro(maandinleg)} per maand`} last={geenPensioen} />
          {!geenPensioen && <Row k="Gewenste maandelijkse uitgaven" v={`${euro(maanduitgaven)} per maand`} />}
          {!geenPensioen && (
            <Row k="Doelleeftijd: geld moet minimaal meegaan tot" v={`${formatLeeftijd(ijkLeeftijd)} jaar`} last={!heeftInkomen} />
          )}
          {!geenPensioen &&
            inkomenBronnen.map((b, i) => (
              <Row
                key={b.naam}
                k={`${b.naam} (netto, vanaf ${formatLeeftijd(b.vanafLeeftijd)} jaar)`}
                v={`${euro(b.bedrag)} per maand`}
                last={i === inkomenBronnen.length - 1}
              />
            ))}
        </div>

        <div className="vc-report-box">
          <div className="vc-report-boxtitle">OPBOUW PER SCENARIO (OP PAPIER)</div>
          <div className="vc-cards3 report">
            {scenarios.map((s) => (
              <div key={s.rate} className="vc-rcard">
                <div className="vc-rcard-naam">{s.naam}</div>
                <div className="vc-rcard-rate">{s.rate}% rendement</div>
                <div className="vc-rcard-num">{euro(eind[s.rate])}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="vc-report-box">
          <div className="vc-report-boxtitle">
            INFLATIE: {formatProcent(inflatie)} PER JAAR (BEDRAGEN IN PRIJZEN VAN NU)
          </div>
          <Row k={`Jouw vermogen op je ${formatLeeftijd(bl)}e, verwacht scenario (op papier)`} v={euro(verwacht.zonder.vermogenNominaal)} />
          <Row k="Hetzelfde vermogen in prijzen van nu" v={euro(verwacht.met.vermogen)} last={geenPensioen} />
          {!geenPensioen && <Row k={`Hetzelfde leven kost op je ${formatLeeftijd(bl)}e per maand (prijzen van dan, inflatie)`} v={euro(uitgavenNaInflatie)} last />}
        </div>

        {!geenPensioen && oordeel && (
          <div className="vc-report-box">
            <div className="vc-report-boxtitle">JE GELD GAAT MEE TOT (MET {formatProcent(inflatie)} INFLATIE)</div>
            <Row
              k="Oordeel"
              v={oordeel === 'groen' ? 'Op koers' : oordeel === 'oranje' ? 'Krap' : 'Tekort'}
              green={oordeel === 'groen'}
              red={oordeel === 'rood'}
            />
            {scenarios.map((s, i) => (
              <Row
                key={s.rate}
                k={`${s.naam} scenario (${s.rate}%)`}
                v={`je ${leeftijdTekst(sc(s.rate).met)}`}
                last={i === scenarios.length - 1}
              />
            ))}
          </div>
        )}

        {!geenPensioen && (
          <div className="vc-report-box">
            <div className="vc-report-boxtitle">VERWACHT SCENARIO: ZONDER EN MET INFLATIE</div>
            <div className="vc-duo flat">
              <div className="vc-duo-head">
                <span />
                <span>ZONDER INFLATIE</span>
                <span className="met">MET {formatProcent(inflatie)}</span>
              </div>
              <DuoRow k="Vermogen" a={euro(verwacht.zonder.vermogen)} b={euro(verwacht.met.vermogen)} />
              <DuoRow k={`Nodig tot je ${formatLeeftijd(ijkLeeftijd)}e`} a={euro(verwacht.zonder.nodig)} b={euro(verwacht.met.nodig)} />
              <DuoRow k="Buffer of tekort" a={bufferTekst(verwacht.zonder.buffer)} b={bufferTekst(verwacht.met.buffer)} />
              <DuoRow k="Geld gaat mee tot" a={`je ${leeftijdTekst(verwacht.zonder)}`} b={`je ${leeftijdTekst(verwacht.met)}`} last />
            </div>
          </div>
        )}

        <div className="vc-report-box">
          <div className="vc-report-boxtitle">WAT KUN JE PER MAAND OPNEMEN (4%-REGEL, VERWACHT SCENARIO)</div>
          <div className="vc-duo flat">
            <div className="vc-duo-head">
              <span />
              <span>ZONDER INFLATIE</span>
              <span className="met">MET {formatProcent(inflatie)}</span>
            </div>
            <DuoRow
              k="Levenslange opname per maand"
              a={euro(verwacht.zonder.vierProcentPerMaand)}
              b={euro(verwacht.met.vierProcentPerMaand)}
              last
            />
          </div>
        </div>

        {!geenPensioen && (
          <div className="vc-report-box">
            <div className="vc-report-boxtitle">BENODIGDE INLEG PER MAAND</div>
            <Row k="Je legt nu in" v={`${euro(maandinleg)} /mnd`} />
            <Row k="Nodig, verwacht scenario, zonder inflatie" v={`${euro(verwacht.zonder.inlegNodig)} /mnd`} />
            <Row k={`Nodig, verwacht scenario, met ${formatProcent(inflatie)} inflatie`} v={`${euro(verwacht.met.inlegNodig)} /mnd`} />
            <Row k={`Nodig, matig scenario, met ${formatProcent(inflatie)} inflatie`} v={`${euro(matig.met.inlegNodig)} /mnd`} last />
          </div>
        )}

        <p className="vc-report-disclaimer">
          © {new Date().getFullYear()} Claudia Voogt. Alle rechten voorbehouden. Deze tool mag niet worden gedeeld, gekopieerd, nagebouwd of hergebruikt zonder schriftelijke toestemming. Deze tool is een hulpmiddel, geen beleggingsadvies. De informatie is met zorg samengesteld, maar er kunnen geen rechten aan worden ontleend. Juistheid en volledigheid worden niet gegarandeerd.
        </p>
        <p className="vc-report-disclaimer">
          Gemaakt met de Vermogensopbouw Calculator van claudiavoogt.nl, beleggingsexpert &amp; investeringsmentor.
          © {new Date().getFullYear()} Claudia Voogt. Alle rechten voorbehouden.
        </p>
      </div>
    </div>
  );
}

const css = `
html, body { margin:0 !important; padding:0 !important; background:#F5F5F5 !important; }
.vc-root { font-family:'Lora',serif; color:#1A1F36; background:#F5F5F5; min-height:100vh; }
.vc-header { background:linear-gradient(110deg,#211A3A 0%, #4A2168 38%, #7A2D8F 100%); color:#fff; text-align:center; padding:42px 20px 38px; }
.vc-eyebrow { color:#3EDCB1; font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:3px; font-size:12px; margin-bottom:8px; }
.vc-eyebrow.dark { color:#2e8999; }
.vc-header h1 { font-family:'Montserrat',sans-serif; font-weight:800; font-size:38px; letter-spacing:1px; margin:0; }
.vc-sub { font-style:italic; color:#e7dcef; margin:10px 0 0; font-size:16px; }
.vc-main { max-width:640px; margin:0 auto; padding:40px 22px 60px; }
.vc-progress { display:flex; gap:8px; margin-bottom:36px; }
.vc-progress span { flex:1; height:5px; border-radius:3px; background:#ddd; }
.vc-progress .done { background:#6B2D84; }
.vc-progress .active { background:#3EDCB1; }
.vc-step { color:#3EDCB1; font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:2px; font-size:12px; margin-bottom:8px; }
.vc-main h2 { font-family:'Lora',serif; font-weight:700; color:#6B2D84; font-size:30px; margin:0 0 12px; }
.vc-desc { color:#6b6b73; font-style:italic; line-height:1.55; margin:0 0 22px; }
.vc-label { display:block; font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:1px; font-size:12px; color:#6B2D84; margin:18px 0 8px; }
.vc-input { width:100%; box-sizing:border-box; padding:15px 16px; border:1px solid #e1dce6; border-radius:12px; font-family:'Lora',serif; font-size:16px; background:#fff; outline:none; }
.vc-input:focus { border-color:#6B2D84; }
.vc-hint { color:#9a9aa2; font-size:13px; margin:8px 0 0; font-style:italic; }
.vc-rightnote { text-align:right; }
.vc-error { color:#d63a1f; font-size:14px; margin:14px 0 0; font-family:'Montserrat',sans-serif; font-weight:600; }
.vc-sliderrow { display:flex; align-items:center; gap:16px; margin-bottom:10px; }
.vc-slider { flex:1; -webkit-appearance:none; appearance:none; height:5px; border-radius:3px; background:#e8d9ef; outline:none; }
.vc-slider::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:20px; height:20px; border-radius:50%; background:#B72452; cursor:pointer; }
.vc-slider::-moz-range-thumb { width:20px; height:20px; border:none; border-radius:50%; background:#B72452; cursor:pointer; }
.vc-slidervalue { font-family:'Montserrat',sans-serif; font-weight:800; color:#6B2D84; font-size:18px; min-width:90px; text-align:right; }
.vc-btns { display:flex; margin-top:30px; }
.vc-right { justify-content:flex-end; }
.vc-between { justify-content:space-between; align-items:center; }
.vc-btngroup { display:flex; gap:12px; }
.vc-btn-primary { background:linear-gradient(135deg,#E21B70,#b3185a); color:#fff; border:none; padding:14px 26px; border-radius:12px; font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:1px; font-size:13px; cursor:pointer; }
.vc-btn-back { background:#fff; color:#1A1F36; border:1px solid #ddd; padding:14px 22px; border-radius:12px; font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:1px; font-size:13px; cursor:pointer; }
.vc-btn-ghost { background:#fff; color:#6b6b73; border:1px solid #ddd; padding:14px 22px; border-radius:12px; font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:1px; font-size:13px; cursor:pointer; }
.vc-cards3 { display:flex; flex-wrap:nowrap; gap:14px; margin-bottom:22px; }
.vc-cards2 { display:flex; flex-wrap:nowrap; gap:14px; margin-bottom:22px; }
.vc-card { flex:1; background:#fff; border:1px solid #ebe7ef; border-radius:16px; padding:20px; }
.vc-card.hl { border:1.5px solid #E21B70; background:#fdf3f8; }
.vc-card.mini { padding:16px; }
.vc-card-label { font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:.5px; font-size:11px; color:#9a9aa2; margin-bottom:6px; }
.vc-card-rate { font-family:'Montserrat',sans-serif; font-weight:600; font-size:13px; margin-bottom:8px; }
.vc-card-num { font-family:'Montserrat',sans-serif; font-weight:800; font-size:26px; color:#6B2D84; }
.vc-card-num.small { font-size:22px; }
.vc-card-num.fuchsia { color:#E21B70; }
.vc-card-note { color:#9a9aa2; font-size:12px; margin-top:6px; line-height:1.4; }
.vc-table { background:#fff; border:1px solid #ebe7ef; border-radius:16px; padding:6px 20px; margin-bottom:14px; }
.vc-row { display:flex; justify-content:space-between; padding:14px 0; border-bottom:1px solid #f0edf3; font-size:15px; }
.vc-row.last { border-bottom:none; }
.vc-row strong { font-family:'Montserrat',sans-serif; font-weight:700; }
.vc-banner { border-radius:16px; padding:26px; text-align:center; color:#fff; margin:18px 0 22px; flex:1; }
.vc-banner.good { background:linear-gradient(135deg,#1f9e6e,#157a52); }
.vc-banner.bad { background:linear-gradient(135deg,#e8472e,#d63a1f); }
.vc-banner.warn { background:linear-gradient(135deg,#f0a020,#d9820f); }
.vc-card.clickable { cursor:pointer; }
.vc-card.clickable:focus-visible { outline:2px solid #6B2D84; }
.vc-duo { background:#fff; border:1px solid #ebe7ef; border-radius:16px; padding:6px 20px; margin-bottom:14px; }
.vc-duo.flat { border:none; padding:0; margin-bottom:0; background:transparent; }
.vc-duo-head, .vc-duo-row { display:grid; grid-template-columns:1.3fr 1fr 1fr; gap:10px; align-items:baseline; }
.vc-duo-head { padding:14px 0 8px; font-family:'Montserrat',sans-serif; font-weight:700; font-size:10px; letter-spacing:.6px; color:#9a9aa2; border-bottom:1px solid #f0edf3; }
.vc-duo-head span { text-align:right; }
.vc-duo-head span.met { color:#6B2D84; }
.vc-duo-row { padding:13px 0; border-bottom:1px solid #f0edf3; font-size:14px; }
.vc-duo-row.last { border-bottom:none; }
.vc-duo-row .a { text-align:right; color:#8a8d99; font-family:'Montserrat',sans-serif; font-weight:600; }
.vc-duo-row .b { text-align:right; font-family:'Montserrat',sans-serif; font-weight:800; color:#1A1F36; }
.vc-duo-row .b.good { color:#1a7a52; }
.vc-duo-row .b.bad { color:#d63a1f; }
.vc-impact { background:#f6effa; border-radius:12px; padding:12px 16px; font-size:14px; color:#4a2168; margin:0 0 18px; }
.vc-chips { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
.vc-chip { font-family:'Montserrat',sans-serif; font-weight:700; font-size:12px; padding:9px 14px; border-radius:999px; border:1.5px solid #d9cfe2; background:#fff; color:#6B2D84; cursor:pointer; }
.vc-chip.on { background:#6B2D84; color:#fff; border-color:#6B2D84; }
.vc-wel { background:#eefaf5; border:1px solid #bfeadb; border-radius:16px; padding:18px 20px; margin:22px 0 14px; }
.vc-wel-titel { font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:1px; font-size:12px; color:#157a52; margin-bottom:8px; }
.vc-wel p { margin:0 0 8px; font-size:15px; line-height:1.55; }
.vc-details { margin:6px 0 18px; }
.vc-details summary { cursor:pointer; font-family:'Montserrat',sans-serif; font-weight:700; font-size:13px; color:#6B2D84; margin-bottom:10px; }
.vc-banner-label { font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:1.5px; font-size:12px; opacity:.9; }
.vc-banner-num { font-family:'Montserrat',sans-serif; font-weight:800; font-size:40px; margin:6px 0; }
.vc-banner-sub { font-style:italic; font-size:14px; opacity:.95; line-height:1.5; }
.vc-h4 { font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:1px; font-size:13px; color:#6B2D84; margin:26px 0 6px; }
.vc-chartwrap { background:#fff; border:1px solid #ebe7ef; border-radius:16px; padding:20px; height:300px; margin-bottom:14px; }
.vc-foot { color:#9a9aa2; font-size:12px; text-align:center; margin:14px 0 24px; }
.vc-loading { text-align:center; color:#6B2D84; font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:1px; font-size:14px; padding:40px 0; }
.vc-cta { background:linear-gradient(110deg,#211A3A,#5a2576 60%,#7A2D8F); border-radius:16px; padding:24px; display:flex; align-items:center; justify-content:space-between; gap:18px; color:#fff; }
.vc-cta h3 { font-family:'Montserrat',sans-serif; font-weight:700; margin:0 0 6px; font-size:18px; }
.vc-cta p { margin:0; font-style:italic; font-size:14px; opacity:.9; }
.vc-disclaimer { background:#f4f1f7; border-radius:12px; padding:18px 20px; color:#6b6b73; font-size:13px; line-height:1.6; margin:24px 0; }
.vc-inkomen { background:#fff; border:1px solid #ebe7ef; border-radius:16px; padding:20px 20px 8px; margin-top:26px; }
.vc-inkomen-titel { font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:1px; font-size:12px; color:#6B2D84; margin-bottom:8px; }
.vc-inkomen-uitleg { color:#6b6b73; font-size:14px; line-height:1.55; margin:0 0 16px; }
.vc-inkrow { margin-bottom:18px; }
.vc-inkname { font-family:'Montserrat',sans-serif; font-weight:800; font-size:13px; color:#1A1F36; margin-bottom:6px; }
.vc-inkfields { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.vc-inkmini { display:block; font-family:'Montserrat',sans-serif; font-weight:600; letter-spacing:.5px; font-size:10px; color:#9a9aa2; margin-bottom:5px; }
.vc-inkhint { color:#9a9aa2; font-size:12.5px; font-style:italic; line-height:1.5; margin:6px 0 10px; }
.vc-inkhint a { color:#6B2D84; }
.vc-skipnote {background:#fdf3f8; border:1px solid #f3c9dd; border-left:5px solid #E21B70; border-radius:12px; padding:16px 18px; margin-top:24px; color:#1A1F36; font-size:15px; line-height:1.55; }
.vc-skipnote strong { font-family:'Montserrat',sans-serif; font-weight:700; }
.vc-nowbar { display:flex; justify-content:space-between; align-items:center; background:linear-gradient(110deg,#211A3A,#5a2576 70%,#7A2D8F); color:#fff; border-radius:14px; padding:16px 22px; margin-bottom:22px; }
.vc-nowbar span { font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:1px; font-size:12px; opacity:.85; }
.vc-nowbar strong { font-family:'Montserrat',sans-serif; font-weight:800; font-size:24px; }
.vc-nowbar small { font-size:13px; font-weight:600; opacity:.8; }
.vc-goal { background:#fff; border:1px solid #ebe7ef; border-radius:16px; padding:22px; margin-bottom:16px; }
.vc-goal.ok { border-left:5px solid #1f9e6e; }
.vc-goal.tekort { border-left:5px solid #e8472e; }
.vc-goal-titel { font-family:'Montserrat',sans-serif; font-weight:700; color:#1A1F36; font-size:17px; }
.vc-goal-uitleg { color:#6b6b73; font-style:italic; font-size:14px; margin:4px 0 16px; }
.vc-goal-grid { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.vc-goal-cell { flex:1; min-width:130px; }
.vc-goal-cell span { display:block; font-family:'Montserrat',sans-serif; font-weight:600; font-size:11px; letter-spacing:.5px; color:#9a9aa2; margin-bottom:4px; }
.vc-goal-cell strong { font-family:'Montserrat',sans-serif; font-weight:800; font-size:20px; color:#6B2D84; }
.vc-goal-cell strong.fuchsia { color:#E21B70; }
.vc-goal-cell strong.navy { color:#1A1F36; }
.vc-goal-arrow { color:#cdbcd9; font-size:22px; font-weight:700; }
.vc-goal-verdict { margin-top:16px; border-radius:10px; padding:12px 14px; font-size:14px; line-height:1.45; font-family:'Montserrat',sans-serif; font-weight:600; }
.vc-goal-verdict.ok { background:#e3f5ec; color:#157a52; }
.vc-goal-verdict.tekort { background:#fdecea; color:#c4341d; }
.vc-pdfwrap { text-align:center; margin:10px 0 4px; }
.vc-footer { background:linear-gradient(110deg,#211A3A,#4A2168 50%,#7A2D8F); padding:36px 20px; text-align:center; }
.vc-logos { display:flex; gap:16px; justify-content:center; margin-bottom:16px; }
.vc-logo { background:#fff; border-radius:10px; width:120px; height:90px; display:flex; align-items:center; justify-content:center; overflow:hidden; }
.vc-logo img { max-width:90%; max-height:90%; }
.vc-logo span { font-family:'Montserrat',sans-serif; font-weight:700; color:#6B2D84; font-size:13px; padding:0 8px; }
.vc-copy { color:#cdbcd9; font-size:13px; margin:0; }
.vc-report { display:none; }
@media print {
  .vc-header, .vc-main, .vc-footer { display:none !important; }
  .vc-report { display:block !important; padding:30px 36px; color:#1A1F36; font-family:'Lora',serif; }
  .vc-report-head { text-align:center; margin-bottom:24px; }
  .vc-report-head h1 { font-family:'Montserrat',sans-serif; font-weight:800; color:#c9c9d0; font-size:30px; margin:6px 0; letter-spacing:1px; }
  .vc-report-head p { font-style:italic; color:#9a9aa2; margin:0; }
  .vc-report-title { font-family:'Lora',serif; font-weight:700; color:#6B2D84; text-align:center; font-size:24px; margin:18px 0 2px; }
  .vc-report-date { text-align:center; color:#9a9aa2; margin:0 0 24px; }
  .vc-report-box { border:1px solid #e5e1ea; border-radius:12px; padding:8px 20px; margin-bottom:16px; }
  .vc-report-boxtitle { font-family:'Montserrat',sans-serif; font-weight:700; color:#6B2D84; letter-spacing:1px; font-size:13px; padding:12px 0 6px; }
  .vc-cards3.report { display:flex; gap:12px; padding-bottom:12px; }
  .vc-rcard { flex:1; border:1px solid #e5e1ea; border-radius:10px; padding:12px; text-align:center; }
  .vc-rcard-naam { font-family:'Montserrat',sans-serif; font-weight:700; color:#6B2D84; font-size:13px; }
  .vc-rcard-rate { color:#9a9aa2; font-size:11px; margin:2px 0 6px; }
  .vc-rcard-num { font-family:'Montserrat',sans-serif; font-weight:800; font-size:17px; }
  .vc-report-disclaimer { color:#6b6b73; font-size:11px; line-height:1.5; margin-top:18px; }
}
.vc-quickedit { background:#f4f1f7; border-radius:14px; padding:20px 22px; margin:24px 0 8px; }
.vc-quickedit-label { font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:2px; font-size:11px; color:#6B2D84; margin-bottom:14px; }
.vc-quickedit-btns { display:flex; flex-wrap:wrap; gap:10px; }
.vc-btn-quick { background:#fff; color:#1A1F36; border:1.5px solid #cdbcd9; padding:10px 18px; border-radius:10px; font-family:'Montserrat',sans-serif; font-weight:700; letter-spacing:.5px; font-size:12px; cursor:pointer; transition:border-color .15s, background .15s; }
.vc-btn-quick:hover { border-color:#6B2D84; background:#f9f5fc; }
@media (max-width:560px) {
  .vc-btn-quick { flex:1; min-width:calc(50% - 5px); text-align:center; }
  .vc-cards3, .vc-cards2 { gap:8px; }
  .vc-card { min-width:0; padding:12px; }
  .vc-card-num { font-size:20px; }
  .vc-card-num.small { font-size:17px; }
  .vc-card-label { font-size:9px; }
  .vc-header h1 { font-size:26px; }
  .vc-cta { flex-direction:column; align-items:flex-start; }
  .vc-duo { padding:4px 14px; }
  .vc-duo-head, .vc-duo-row { grid-template-columns:1.1fr 1fr 1fr; gap:6px; }
  .vc-duo-row { font-size:13px; }
  .vc-goal-arrow { display:none; }
  .vc-goal-grid { gap:18px; }
  .vc-goal-cell { min-width:calc(50% - 9px); }
}
`;
