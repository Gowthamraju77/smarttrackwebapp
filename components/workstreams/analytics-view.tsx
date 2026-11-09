"use client";

import { useId, useState } from "react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Database,
  FlaskConical,
  Info,
  Satellite,
  Table2,
} from "lucide-react";
import styles from "./analytics-view.module.css";

type RangeDays = 7 | 14 | 30;
type TrendMetric = "completeness" | "received";
type DailyPoint = {
  date: string;
  expected: number;
  received: number;
  gps: number;
  imu: number;
};

// Deterministic synthetic fixtures. These are never a fallback for an API read.
const DEMO_COUNTS: readonly (readonly [number, number, number])[] = [
  [1312, 1289, 1240], [1350, 1320, 1296], [1390, 1352, 1311],
  [1335, 1304, 1280], [1401, 1374, 1340], [1387, 1360, 1318],
  [1260, 1197, 1164], [1344, 1310, 1292], [1408, 1378, 1350],
  [1365, 1321, 1288], [1304, 1180, 1120], [1080, 860, 940],
  [0, 0, 0], [1182, 1080, 1012], [1320, 1260, 1204],
  [1376, 1340, 1302], [1394, 1368, 1320], [1402, 1379, 1348],
  [1360, 1324, 1286], [1290, 1200, 1182], [1378, 1342, 1280],
  [1406, 1378, 1340], [1398, 1359, 1322], [1368, 1332, 1280],
  [1412, 1380, 1361], [1224, 1102, 1084], [1386, 1344, 1310],
  [1320, 880, 0], [1404, 1372, 1324], [1422, 1390, 1368],
];

const DEMO_POINTS: DailyPoint[] = DEMO_COUNTS.map(([received, gps, imu], index) => ({
  date: new Date(Date.UTC(2026, 8, 11 + index)).toISOString().slice(0, 10),
  expected: 1440,
  received,
  gps,
  imu,
}));

const numberFormat = new Intl.NumberFormat("en-US");
const percentFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});
const shortDateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", timeZone: "UTC",
});

function dateLabel(date: string, short = false) {
  return (short ? shortDateFormat : dateFormat).format(new Date(`${date}T00:00:00Z`));
}

function percentage(available: number, expected: number) {
  return expected === 0 ? "No records" : percentFormat.format(available / expected);
}

function sensorLabel(available: number, received: number) {
  return received === 0
    ? "Unavailable · no records"
    : `${percentage(available, received)} · ${numberFormat.format(available)} of ${numberFormat.format(received)}`;
}

function totalsFor(points: DailyPoint[]) {
  return points.reduce((total, point) => ({
    expected: total.expected + point.expected,
    received: total.received + point.received,
    gps: total.gps + point.gps,
    imu: total.imu + point.imu,
  }), { expected: 0, received: 0, gps: 0, imu: 0 });
}

function TrendPlot({ points, metric, selectedIndex, id }: {
  points: DailyPoint[];
  metric: TrendMetric;
  selectedIndex: number;
  id: string;
}) {
  const left = 48;
  const right = 618;
  const top = 22;
  const bottom = 206;
  const max = metric === "completeness" ? 100 : 1600;
  const values = points.map((point) => metric === "completeness"
    ? point.received / point.expected * 100
    : point.received);
  const x = (index: number) => left + index * (right - left) / Math.max(1, points.length - 1);
  const y = (value: number) => bottom - value / max * (bottom - top);
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(value)}`).join(" ");
  const selected = points[selectedIndex];
  const labelInterval = points.length <= 7 ? 1 : points.length <= 14 ? 3 : 6;

  return (
    <svg className={styles.plot} viewBox="0 0 640 250" role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>{`Synthetic daily ${metric === "completeness" ? "data completeness" : "records received"}`}</title>
      <desc id={`${id}-description`}>
        {points.length} days, from {dateLabel(points[0].date)} to {dateLabel(points[points.length - 1].date)}.
        The vertical scale starts at zero. Selected day: {dateLabel(selected.date)}, {metric === "completeness"
          ? `${percentage(selected.received, selected.expected)} completeness.`
          : `${numberFormat.format(selected.received)} records received.`}
        Use the day selector to inspect each point, or Data table for all exact values.
      </desc>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--teal, #2bb7a9)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--teal, #2bb7a9)" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((tick) => {
        const value = tick * max / 4;
        return (
          <g key={value}>
            <line className={styles.gridLine} x1={left} y1={y(value)} x2={right} y2={y(value)} />
            <text className={styles.axisLabel} x={left - 10} y={y(value) + 4} textAnchor="end">
              {metric === "completeness" ? `${value}%` : numberFormat.format(value)}
            </text>
          </g>
        );
      })}
      {metric === "received" && (
        <line className={styles.expectedLine} x1={left} y1={y(1440)} x2={right} y2={y(1440)} />
      )}
      <path d={`${path} L${right},${bottom} L${left},${bottom} Z`} fill={`url(#${id}-fill)`} />
      <path className={styles.trendLine} d={path} />
      {values.map((value, index) => <circle className={styles.point} key={points[index].date} cx={x(index)} cy={y(value)} r="3" />)}
      <line className={styles.selectedLine} x1={x(selectedIndex)} x2={x(selectedIndex)} y1={top} y2={bottom} />
      <circle className={styles.selectedPoint} cx={x(selectedIndex)} cy={y(values[selectedIndex])} r="6" />
      {points.map((point, index) => (index % labelInterval === 0 || index === points.length - 1) && (
        <text className={styles.axisLabel} key={point.date} x={x(index)} y="233"
          textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>
          {dateLabel(point.date, true)}
        </text>
      ))}
    </svg>
  );
}

export default function AnalyticsView() {
  const id = useId();
  const [rangeDays, setRangeDays] = useState<RangeDays>(7);
  const [metric, setMetric] = useState<TrendMetric>("completeness");
  const [presentation, setPresentation] = useState<"charts" | "table">("charts");
  const [selectedDate, setSelectedDate] = useState(DEMO_POINTS[DEMO_POINTS.length - 1].date);
  const points = DEMO_POINTS.slice(-rangeDays);
  const total = totalsFor(points);
  const selectedIndex = Math.max(0, points.findIndex((point) => point.date === selectedDate));
  const selected = points[selectedIndex];
  const rangeLabel = `${dateLabel(points[0].date, true)} – ${dateLabel(points[points.length - 1].date)}`;
  const metrics = [
    { label: "Records received", value: numberFormat.format(total.received), detail: `of ${numberFormat.format(total.expected)} expected`, icon: Database, tone: "teal" },
    { label: "Data completeness", value: percentage(total.received, total.expected), detail: `${numberFormat.format(total.expected - total.received)} records missing`, icon: BarChart3, tone: "blue" },
    { label: "GPS fix availability", value: percentage(total.gps, total.received), detail: "among records received", icon: Satellite, tone: "purple" },
    { label: "IMU sample availability", value: percentage(total.imu, total.received), detail: "among records received", icon: Activity, tone: "orange" },
  ];

  function changeRange(days: RangeDays) {
    setRangeDays(days);
    if (!DEMO_POINTS.slice(-days).some((point) => point.date === selectedDate)) {
      setSelectedDate(DEMO_POINTS[DEMO_POINTS.length - 1].date);
    }
  }

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Intelligence / demo workspace</p>
          <h1>Analytics</h1>
          <p className={styles.subtitle}>A clearer picture of the data behind every journey.</p>
        </div>
        <span className={styles.dateBadge}><CalendarDays size={16} aria-hidden="true" /> Snapshot ends 10 Oct 2026 · UTC</span>
      </header>

      <aside className={styles.demoNotice} aria-label="Synthetic demo notice">
        <FlaskConical size={20} aria-hidden="true" />
        <div><strong>Synthetic demo · local only</strong><p>All counts and charts are illustrative fixtures. Filters only change this preview; this view does not read connected devices or production analytics.</p></div>
      </aside>

      <div className={styles.toolbar}>
        <fieldset className={styles.rangeGroup}>
          <legend>Demo date range</legend>
          <div className={styles.segmented}>
            {([7, 14, 30] as const).map((days) => (
              <label className={styles.rangeOption} key={days}>
                <input type="radio" name={`${id}-range`} value={days} checked={rangeDays === days} onChange={() => changeRange(days)} />
                <span>{days} days</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className={styles.metricFilter}>
          <label htmlFor={`${id}-metric`}>Trend metric</label>
          <select id={`${id}-metric`} value={metric} onChange={(event) => setMetric(event.target.value as TrendMetric)}>
            <option value="completeness">Data completeness</option>
            <option value="received">Records received</option>
          </select>
        </div>
        <div className={styles.presentation} role="group" aria-label="Analytics presentation">
          <button type="button" aria-pressed={presentation === "charts"} aria-controls={`${id}-results`} onClick={() => setPresentation("charts")}><BarChart3 size={16} aria-hidden="true" /> Charts</button>
          <button type="button" aria-pressed={presentation === "table"} aria-controls={`${id}-results`} onClick={() => setPresentation("table")}><Table2 size={16} aria-hidden="true" /> Data table</button>
        </div>
      </div>

      <p className={styles.rangeSummary} role="status" aria-atomic="true">
        <strong>{rangeLabel}</strong> · {rangeDays} daily points · {presentation === "charts" ? `${metric === "completeness" ? "Completeness" : "Received records"} chart` : "All metrics in table"} · synthetic data
      </p>

      <section className={styles.metrics} aria-label="Synthetic totals for selected date range">
        {metrics.map(({ label, value, detail, icon: Icon, tone }) => (
          <article className={styles.metricCard} key={label}>
            <div className={`${styles.metricIcon} ${styles[tone]}`}><Icon size={18} aria-hidden="true" /></div>
            <h2>{label}</h2><strong className={styles.metricValue}>{value}</strong><p>{detail}</p>
          </article>
        ))}
      </section>

      <div id={`${id}-results`}>
        {presentation === "charts" ? (
          <div className={styles.chartGrid}>
            <section className={styles.panel} aria-labelledby={`${id}-trend-heading`}>
              <div className={styles.panelHeader}>
                <div><p className={styles.eyebrow}>Collection over time</p><h2 id={`${id}-trend-heading`}>{metric === "completeness" ? "Data completeness" : "Records received"}</h2></div>
                <span className={styles.demoBadge}>Demo</span>
              </div>
              <p className={styles.panelDescription}>{metric === "completeness" ? "Received records as a share of expected records, each day." : "Daily received records against the demo expectation of 1,440."}</p>
              <div className={styles.legend} aria-label="Chart legend">
                <span><i className={styles.legendRecorded} aria-hidden="true" />{metric === "completeness" ? "Completeness" : "Received"}</span>
                {metric === "received" && <span><i className={styles.legendExpected} aria-hidden="true" />Expected</span>}
              </div>
              <div className={styles.plotScroll} role="region" aria-label="Daily trend chart, scroll horizontally if needed" tabIndex={0}>
                <TrendPlot points={points} metric={metric} selectedIndex={selectedIndex} id={`${id}-plot`} />
              </div>
              <div className={styles.dayControls}>
                <div><label htmlFor={`${id}-day`}>Inspect a demo day</label><select id={`${id}-day`} value={selected.date} onChange={(event) => setSelectedDate(event.target.value)}>
                  {points.map((point) => <option value={point.date} key={point.date}>{dateLabel(point.date)}{point.received === 0 ? " · no records" : ""}</option>)}
                </select></div>
                <div className={styles.dayButtons}>
                  <button type="button" aria-label="Inspect previous day" disabled={selectedIndex === 0} onClick={() => setSelectedDate(points[selectedIndex - 1].date)}><ChevronLeft size={18} aria-hidden="true" /></button>
                  <button type="button" aria-label="Inspect next day" disabled={selectedIndex === points.length - 1} onClick={() => setSelectedDate(points[selectedIndex + 1].date)}><ChevronRight size={18} aria-hidden="true" /></button>
                </div>
              </div>
              <div className={styles.dayDetail} aria-live="polite" aria-atomic="true">
                <p><strong>{dateLabel(selected.date)}</strong><span>Synthetic day</span></p>
                <dl>
                  <div><dt>Received / expected</dt><dd>{numberFormat.format(selected.received)} / {numberFormat.format(selected.expected)}</dd></div>
                  <div><dt>Completeness</dt><dd>{percentage(selected.received, selected.expected)}</dd></div>
                  <div><dt>GPS fix availability</dt><dd>{sensorLabel(selected.gps, selected.received)}</dd></div>
                  <div><dt>IMU sample availability</dt><dd>{sensorLabel(selected.imu, selected.received)}</dd></div>
                </dl>
                {selected.received === 0 && <p className={styles.missingNote}>No records in this demo day. Sensor availability cannot be assessed.</p>}
                {selected.received > 0 && selected.imu === 0 && <p className={styles.missingNote}>No IMU samples in this demo day. Availability is 0%; the sensor reading is unknown.</p>}
              </div>
            </section>

            <section className={styles.panel} aria-labelledby={`${id}-sensors-heading`}>
              <div className={styles.panelHeader}><div><p className={styles.eyebrow}>Evidence, not assumptions</p><h2 id={`${id}-sensors-heading`}>Sensor availability</h2></div><span className={styles.demoBadge}>Demo</span></div>
              <p className={styles.panelDescription}>Coverage across records received in the selected {rangeDays}-day range.</p>
              <div className={styles.sensorList}>
                {([{ label: "GPS fix reported", count: total.gps, icon: Satellite, tone: "gps" }, { label: "IMU sample included", count: total.imu, icon: Activity, tone: "imu" }] as const).map(({ label, count, icon: Icon, tone }) => (
                  <div className={styles.sensor} key={label}>
                    <div className={styles.sensorHeading}><span><Icon size={16} aria-hidden="true" />{label}</span><strong>{percentage(count, total.received)}</strong></div>
                    <div className={styles.sensorTrack} aria-hidden="true"><div className={styles[tone]} style={{ width: `${total.received === 0 ? 0 : count / total.received * 100}%` }} /></div>
                    <p>{numberFormat.format(count)} of {numberFormat.format(total.received)} records</p>
                  </div>
                ))}
              </div>
              <div className={styles.coverageNote}><Info size={17} aria-hidden="true" /><p>Availability measures whether a signal is present. Missing GPS fixes and IMU samples are excluded from the available count, never filled with invented readings.</p></div>
              <dl className={styles.coverageFacts}>
                <div><dt>Expected records</dt><dd>{numberFormat.format(total.expected)}</dd></div>
                <div><dt>Missing records</dt><dd>{numberFormat.format(total.expected - total.received)}</dd></div>
                <div><dt>Time basis</dt><dd>UTC calendar days</dd></div>
              </dl>
              <p className={styles.sensorFootnote}>Historical synthetic coverage does not indicate current device health.</p>
            </section>
          </div>
        ) : (
          <section className={styles.panel} aria-labelledby={`${id}-table-heading`}>
            <div className={styles.panelHeader}><div><p className={styles.eyebrow}>Exact chart values</p><h2 id={`${id}-table-heading`}>Daily data table</h2></div><span className={styles.demoBadge}>Demo</span></div>
            <div className={styles.tableScroll} role="region" aria-label="Synthetic analytics data table, scroll horizontally if needed" tabIndex={0}>
              <table>
                <caption>{rangeLabel}, UTC. All values synthetic. GPS and IMU columns show available records as a share of received records. “No records” means availability cannot be assessed.</caption>
                <thead><tr><th scope="col">Date (UTC)</th><th scope="col">Expected</th><th scope="col">Received</th><th scope="col">Missing</th><th scope="col">Completeness</th><th scope="col">GPS fix available</th><th scope="col">IMU available</th></tr></thead>
                <tbody>{points.map((point) => (
                  <tr key={point.date} data-empty={point.received === 0 || undefined}>
                    <th scope="row">{dateLabel(point.date)}{point.received === 0 && <span className={styles.rowNote}>No records</span>}</th>
                    <td>{numberFormat.format(point.expected)}</td><td>{numberFormat.format(point.received)}</td><td>{numberFormat.format(point.expected - point.received)}</td><td>{percentage(point.received, point.expected)}</td>
                    <td>{percentage(point.gps, point.received)}<span className={styles.cellDetail}>{numberFormat.format(point.gps)} / {numberFormat.format(point.received)}</span></td>
                    <td>{percentage(point.imu, point.received)}<span className={styles.cellDetail}>{numberFormat.format(point.imu)} / {numberFormat.format(point.received)}</span></td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><th scope="row">Range total<span className={styles.cellDetail}>Weighted percentages</span></th><td>{numberFormat.format(total.expected)}</td><td>{numberFormat.format(total.received)}</td><td>{numberFormat.format(total.expected - total.received)}</td><td>{percentage(total.received, total.expected)}</td><td>{percentage(total.gps, total.received)}<span className={styles.cellDetail}>{numberFormat.format(total.gps)} / {numberFormat.format(total.received)}</span></td><td>{percentage(total.imu, total.received)}<span className={styles.cellDetail}>{numberFormat.format(total.imu)} / {numberFormat.format(total.received)}</span></td></tr></tfoot>
              </table>
            </div>
          </section>
        )}
      </div>

      <footer className={styles.methodology}>
        <div><Info size={18} aria-hidden="true" /><div><h2>How to read this demo</h2><p>Completeness = received ÷ expected records. The fixture expects one record per minute (1,440 per UTC day). Sensor availability = records with that signal ÷ records received. Range percentages use summed counts, not averages of daily percentages.</p></div></div>
        <div className={styles.mlStatus}><strong>ML reliability: unavailable</strong><span>No evaluated model or scoring service is connected to this view. No safety probability is shown.</span></div>
      </footer>
    </div>
  );
}
