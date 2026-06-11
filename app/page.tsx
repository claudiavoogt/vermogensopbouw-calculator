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
interface Goal {
  titel: string;
  uitleg: string;
  opbouw: number | null;
  midLabel: string;
  midValue: number;
  inleg: number;
  toon: boolean;
}
interface Results {
  eind: Record<number, number>;
  nominaalEind: number;
  totaalIngelegd: number;
  benodigd: Record<number, number>;
  benodigdNominaal: number;
  buffer: number;
  fInfl: number;
  reeelEind: number;
  uitgavenNaInflatie: number;
  benodigdNaInflatie: number;
  inlegInStandHouden: number;
  inlegLevenskosten: number;
  inlegLevenskostenInflatie: number;
  chart: { labels: number[]; series: { rate: number; data: number[] }[] };
  opbouwjaren: number;
  onttrekkingsjaren: number;
}

// ---------- Rekenkunde draait server-side in app/api/bereken/route.ts ----------
const euro = (n: number): string =>
  '€ ' + new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const INFLATIE = 2;
const RENDEMENT = 10;

const scenarios: Scenario[] = [
  { naam: 'Matig', rate: 7, kleur: '#8a8d99' },
  { naam: 'Normaal', rate: RENDEMENT, kleur: '#6B2D84' },
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
  const [error, setError] = useState<string>('');
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

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

  // ---------- Resultaten komen server-side terug uit de Netlify function ----------
  const eind = results?.eind ?? ({ 7: 0, 10: 0, 12: 0 } as Record<number, number>);
  const nominaalEind = results?.nominaalEind ?? 0;
  const totaalIngelegd = results?.totaalIngelegd ?? 0;
  const benodigd = results?.benodigd ?? ({ 7: 0, 10: 0, 12: 0 } as Record<number, number>);
  const benodigdNominaal = results?.benodigdNominaal ?? 0;
  const buffer = results?.buffer ?? 0;
  const fInfl = results?.fInfl ?? 1;
  const reeelEind = results?.reeelEind ?? 0;
  const uitgavenNaInflatie = results?.uitgavenNaInflatie ?? 0;
  const benodigdNaInflatie = results?.benodigdNaInflatie ?? 0;
  const inlegInStandHouden = results?.inlegInStandHouden ?? 0;
  const inlegLevenskosten = results?.inlegLevenskosten ?? 0;
  const inlegLevenskostenInflatie = results?.inlegLevenskostenInflatie ?? 0;

  const fetchResults = async (override: Record<string, unknown> = {}) => {
    setLoading(true);
    try {
      const payload = {
        startbedrag,
        maandinleg,
        maanduitgaven,
        opbouwjaren: Math.max(0, bl - hl),
        onttrekkingsjaren: Math.max(0, tl - bl),
        geenPensioen,
        ...override,
      };
      const res = await fetch('/api/bereken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setResults((await res.json()) as Results);
    } catch {
      setResults(null);
    } finally {
      setLoading(false);
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
              <Row k="Verwachte groei (normaal)" v={euro(nominaalEind - totaalIngelegd)} />
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
              Je wilt het vermogen beschikbaar hebben op je {bl ? bl + 'e' : '…'}. Tot welke leeftijd moet het vermogen meegaan?
            </label>
            <input
              className="vc-input"
              type="number"
              placeholder="bijv. 85"
              value={totLeeftijd}
              onChange={(e) => setTotLeeftijd(e.target.value)}
            />
            <p className="vc-hint">Liever een jaar te veel dan te weinig.</p>
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
            <div className="vc-step">STAP 5 VAN 7 — TOTAALOVERZICHT</div>
            <h2>Ben je op koers?</h2>
            <p className="vc-desc">
              Op basis van {euro(maandinleg)} per maand inleggen
              {geenPensioen ? '.' : ` en ${euro(maanduitgaven)} per maand opnemen.`} Normaal scenario (10% rendement).
            </p>
            <div className="vc-cards2">
              <div className="vc-card">
                <div className="vc-card-label">JIJ BOUWT OP</div>
                <div className="vc-card-num">{euro(nominaalEind)}</div>
                <div className="vc-card-note">Op {bl}-jarige leeftijd bij 10% rendement</div>
              </div>
              {!geenPensioen && (
                <div className="vc-card">
                  <div className="vc-card-label">JE HEBT NODIG</div>
                  <div className="vc-card-num">{euro(benodigdNominaal)}</div>
                  <div className="vc-card-note">
                    {onttrekkingsjaren} jaar lang {euro(maanduitgaven)}/maand
                  </div>
                </div>
              )}
            </div>
            <div className={'vc-banner ' + (buffer >= 0 ? 'good' : 'bad')}>
              <div className="vc-banner-label">{buffer >= 0 ? 'JE HEBT EEN BUFFER VAN' : 'JE KOMT TEKORT'}</div>
              <div className="vc-banner-num">{euro(Math.abs(buffer))}</div>
              <div className="vc-banner-sub">
                {geenPensioen
                  ? 'Dit vermogen bouw je vrij op, zonder vaste opnamebehoefte.'
                  : buffer >= 0
                  ? 'Je bouwt meer op dan je nodig hebt. Je zit op koers, met ruimte over.'
                  : 'Je bouwt minder op dan je nodig hebt. Overweeg je inleg te verhogen.'}
              </div>
            </div>
            {!geenPensioen && (
              <>
                <h4 className="vc-h4">BENODIGD VERMOGEN PER SCENARIO</h4>
                <p className="vc-desc">
                  Het vermogen blijft belegd tijdens de onttrekkingsperiode. Bij een hoger rendement heb je minder
                  startkapitaal nodig.
                </p>
                <div className="vc-cards3">
                  {scenarios.map((s) => (
                    <div key={s.rate} className={'vc-card mini' + (s.rate === RENDEMENT ? ' hl' : '')}>
                      <div className="vc-card-label">{s.naam.toUpperCase()} SCENARIO</div>
                      <div className="vc-card-rate" style={{ color: '#3EDCB1' }}>
                        {s.rate}% per jaar
                      </div>
                      <div className="vc-card-num small">{euro(benodigd[s.rate])}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="vc-table">
              <Row k="Opbouwperiode" v={`${opbouwjaren} jaar`} />
              {!geenPensioen && <Row k="Onttrekkingsperiode" v={`${onttrekkingsjaren} jaar (${bl} tot ${tl})`} />}
              <Row k="Maandelijkse inleg" v={euro(maandinleg)} />
              {!geenPensioen && <Row k="Gewenste maandelijkse uitgaven" v={euro(maanduitgaven)} />}
              <Row k="Opgebouwd vermogen (10%)" v={euro(nominaalEind)} />
              {!geenPensioen && <Row k="Benodigd vermogen (10%)" v={euro(benodigdNominaal)} />}
              <Row k="Buffer" v={euro(buffer)} green last />
            </div>
            <Foot text="Berekening op basis van bruto rendement, zonder box 3 belasting." />
            <div className="vc-cta">
              <div>
                <h3>Wat doet inflatie met jouw plan?</h3>
                <p>Zie wat 2% inflatie per jaar betekent voor je eindkapitaal en levenskosten.</p>
              </div>
              <button className="vc-btn-primary" onClick={() => go(6)}>
                BEKIJK INFLATIE →
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
            <div className="vc-step">STAP 6 VAN 7 — INFLATIEGECORRIGEERD</div>
            <h2>Wat doet inflatie met jouw plan?</h2>
            <p className="vc-desc">
              Bij {INFLATIE}% inflatie per jaar kost hetzelfde leven na {opbouwjaren} jaar {euro(uitgavenNaInflatie)} per
              maand in plaats van {euro(maanduitgaven)}. Dit is wat dat betekent voor jouw plan.
            </p>
            <h4 className="vc-h4">JOUW EINDKAPITAAL IN HUIDIGE KOOPKRACHT</h4>
            <p className="vc-desc">
              Door inflatie is €1 in de toekomst minder waard. Dit is wat jouw opgebouwde vermogen straks écht betekent.
            </p>
            <div className="vc-cards2">
              <div className="vc-card">
                <div className="vc-card-label">NOMINAAL (ZONDER INFLATIE)</div>
                <div className="vc-card-num">{euro(nominaalEind)}</div>
                <div className="vc-card-note">wat je opbouwt op papier</div>
              </div>
              <div className="vc-card hl">
                <div className="vc-card-label">REËEL (MET {INFLATIE}% INFLATIE)</div>
                <div className="vc-card-num fuchsia">{euro(reeelEind)}</div>
                <div className="vc-card-note">koopkracht in huidige euro's</div>
              </div>
            </div>
            {!geenPensioen && (
              <>
                <h4 className="vc-h4">WAT JE NODIG HEBT NA INFLATIE</h4>
                <p className="vc-desc">
                  Je levenskosten stijgen mee met inflatie. Over {opbouwjaren} jaar kost hetzelfde leven meer. Dit is
                  hoeveel vermogen je dan écht nodig hebt.
                </p>
                <div className="vc-cards2">
                  <div className="vc-card">
                    <div className="vc-card-label">BENODIGD (ZONDER INFLATIE)</div>
                    <div className="vc-card-num small">{euro(benodigdNominaal)}</div>
                    <div className="vc-card-note">op basis van huidige kosten</div>
                  </div>
                  <div className="vc-card hl">
                    <div className="vc-card-label">BENODIGD (MET {INFLATIE}% INFLATIE)</div>
                    <div className="vc-card-num small fuchsia">{euro(benodigdNaInflatie)}</div>
                    <div className="vc-card-note">gecorrigeerde levenskosten</div>
                  </div>
                </div>
              </>
            )}
            <div className="vc-table">
              <Row k="Opbouwperiode" v={`${opbouwjaren} jaar`} />
              <Row k="Inflatiepercentage" v={`${INFLATIE}% per jaar`} />
              {!geenPensioen && <Row k="Maandelijkse uitgaven nu" v={euro(maanduitgaven)} />}
              {!geenPensioen && <Row k={`Maandelijkse uitgaven na ${opbouwjaren} jaar`} v={euro(uitgavenNaInflatie)} last />}
              {geenPensioen && <Row k="Reëel eindkapitaal (huidige koopkracht)" v={euro(reeelEind)} last />}
            </div>
            <Foot
              text={`Berekening op basis van bruto rendement, zonder box 3 belasting. Inflatie: ${INFLATIE}% per jaar.`}
            />
            <div className="vc-cta">
              <div>
                <h3>Wat moet jij extra inleggen?</h3>
                <p>Bereken welke maandelijkse inleg je nodig hebt om je doelen inflatiegecorrigeerd te halen.</p>
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
            <p className="vc-desc">
              Dit is wat je per maand zou moeten inleggen om elk doel te halen. We zetten het naast wat je nu inlegt, zodat
              je het verschil meteen ziet.
            </p>

            <div className="vc-nowbar">
              <span>JE LEGT NU IN</span>
              <strong>
                {euro(maandinleg)}
                <small> per maand</small>
              </strong>
            </div>

            {(
              [
                {
                  titel: 'Je vermogen beschermen tegen inflatie',
                  uitleg:
                    'Je bouwt nu een bedrag op, maar door inflatie is dat straks minder waard. Dit is de inleg om je koopkracht van vandaag te behouden.',
                  opbouw: nominaalEind,
                  midLabel: 'WAARD NA INFLATIE',
                  midValue: reeelEind,
                  inleg: inlegInStandHouden,
                  toon: true,
                },
                {
                  titel: 'Je levenskosten kunnen betalen (zonder inflatie)',
                  uitleg: 'Genoeg vermogen om van te leven, op basis van wat het leven nu kost.',
                  opbouw: null,
                  midLabel: 'HIERVOOR HEB JE NODIG',
                  midValue: benodigdNominaal,
                  inleg: inlegLevenskosten,
                  toon: !geenPensioen,
                },
                {
                  titel: 'Je levenskosten betalen ná inflatie',
                  uitleg: 'Genoeg vermogen om van te leven als alles straks duurder is.',
                  opbouw: nominaalEind,
                  midLabel: 'HIERVOOR HEB JE NODIG',
                  midValue: benodigdNaInflatie,
                  inleg: inlegLevenskostenInflatie,
                  toon: !geenPensioen,
                },
              ] as Goal[]
            )
              .filter((g) => g.toon)
              .map((g, i) => {
                const verschil = maandinleg - g.inleg;
                const haalbaar = verschil >= 0;
                return (
                  <div key={i} className={'vc-goal ' + (haalbaar ? 'ok' : 'tekort')}>
                    <div className="vc-goal-titel">{g.titel}</div>
                    <div className="vc-goal-uitleg">{g.uitleg}</div>
                    <div className="vc-goal-grid">
                      {g.opbouw != null && (
                        <div className="vc-goal-cell">
                          <span>JE BOUWT NU OP</span>
                          <strong className="navy">{euro(g.opbouw)}</strong>
                        </div>
                      )}
                      <div className="vc-goal-cell">
                        <span>{g.midLabel}</span>
                        <strong>{euro(g.midValue)}</strong>
                      </div>
                      <div className="vc-goal-arrow">→</div>
                      <div className="vc-goal-cell">
                        <span>INLEG PER MAAND</span>
                        <strong className="fuchsia">{euro(g.inleg)}</strong>
                      </div>
                    </div>
                    <div className={'vc-goal-verdict ' + (haalbaar ? 'ok' : 'tekort')}>
                      {haalbaar
                        ? `Dit haal je al met je huidige inleg. Je houdt ${euro(verschil)} per maand over.`
                        : `Hiervoor heb je ${euro(-verschil)} per maand extra nodig dan je nu inlegt.`}
                    </div>
                  </div>
                );
              })}

            <Foot
              text={`Berekening op basis van ${RENDEMENT}% bruto rendement, zonder box 3 belasting. Inflatie: ${INFLATIE}% per jaar.`}
            />

            <p className="vc-disclaimer">
              Deze calculator is puur informatief en gebaseerd op aannames ({INFLATIE}% inflatie, {RENDEMENT}% rendement,
              geen box 3 belasting). Dit is geen beleggingsadvies en biedt geen garantie op werkelijke rendementen. Jouw
              werkelijke resultaten kunnen sterk afwijken op basis van marktomstandigheden, je keuzes en persoonlijke
              situatie.
            </p>

            <div className="vc-pdfwrap">
              <button className="vc-btn-primary" onClick={printPdf}>
                OPSLAAN ALS PDF
              </button>
              <p className="vc-hint">Bestand → Afdrukken → Opslaan als PDF</p>
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
        <p className="vc-copy" style={{ marginTop: 6, opacity: 0.65, fontSize: 11 }}>
          © {new Date().getFullYear()} Claudia Voogt. Alle rechten voorbehouden. Deze tool mag niet worden gekopieerd, nagebouwd of hergebruikt zonder schriftelijke toestemming.
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
          <Row k="Opbouwtijd" v={`${opbouwjaren} jaar`} />
          <Row k="Maandelijkse inleg" v={`${euro(maandinleg)} per maand`} />
          {!geenPensioen && <Row k="Gewenste maandelijkse uitgaven" v={`${euro(maanduitgaven)} per maand`} last />}
        </div>

        <div className="vc-report-box">
          <div className="vc-report-boxtitle">OPBOUW PER SCENARIO</div>
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
          <div className="vc-report-boxtitle">INFLATIEGECORRIGEERD</div>
          <Row k="Reëel eindkapitaal (huidige koopkracht)" v={euro(reeelEind)} last={geenPensioen} />
          {!geenPensioen && <Row k="Benodigd na inflatie" v={euro(benodigdNaInflatie)} last />}
        </div>

        <div className="vc-report-box">
          <div className="vc-report-boxtitle">JOUW DOELEN EN BENODIGDE INLEG</div>
          <Row k="Je legt nu in" v={`${euro(maandinleg)} /mnd`} />
          <Row k="Vermogen beschermen tegen inflatie" v={`${euro(inlegInStandHouden)} /mnd`} last={geenPensioen} />
          {!geenPensioen && <Row k="Levenskosten kunnen betalen" v={`${euro(inlegLevenskosten)} /mnd`} />}
          {!geenPensioen && <Row k="Levenskosten betalen na inflatie" v={`${euro(inlegLevenskostenInflatie)} /mnd`} last />}
        </div>

        <p className="vc-report-disclaimer">
          Deze calculator is puur informatief en gebaseerd op aannames ({INFLATIE}% inflatie, {RENDEMENT}% rendement,
          geen box 3 belasting). Dit is geen beleggingsadvies en biedt geen garantie op werkelijke rendementen. Jouw
          werkelijke resultaten kunnen sterk afwijken op basis van marktomstandigheden, je keuzes en persoonlijke
          situatie.
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
.vc-banner { border-radius:16px; padding:26px; text-align:center; color:#fff; margin-bottom:22px; flex:1; }
.vc-banner.good { background:linear-gradient(135deg,#1f9e6e,#157a52); }
.vc-banner.bad { background:linear-gradient(135deg,#e8472e,#d63a1f); }
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
.vc-skipnote { background:#fdf3f8; border:1px solid #f3c9dd; border-left:5px solid #E21B70; border-radius:12px; padding:16px 18px; margin-top:24px; color:#1A1F36; font-size:15px; line-height:1.55; }
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
@media (max-width:560px) {
  .vc-cards3, .vc-cards2 { flex-wrap:wrap; }
  .vc-card { min-width:calc(50% - 14px); }
  .vc-header h1 { font-size:26px; }
  .vc-cta { flex-direction:column; align-items:flex-start; }
  .vc-goal-arrow { display:none; }
  .vc-goal-grid { gap:18px; }
  .vc-goal-cell { min-width:calc(50% - 9px); }
}
`;
