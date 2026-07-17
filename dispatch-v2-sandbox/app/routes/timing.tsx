import { data, Form, Link, useLoaderData } from "react-router";
import { requireDispatchUser } from "../lib/auth.server";
import { PermissionNav } from "../components/PermissionNav";
import {
  getDispatchTimingInsights,
  type DispatchTimingAverage,
} from "../lib/dispatch.server";

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "timing");
  const started = performance.now();
  const insights = await getDispatchTimingInsights(1000);
  return data({
    insights,
    loadedAt: new Date().toISOString(),
    loadMs: Math.round(performance.now() - started),
  });
}

function formatMinutes(value: number | null | undefined) {
  if (!value) return "No data";
  const rounded = Math.round(value);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatFactor(value: number | null | undefined) {
  if (!value) return "No data";
  return `${value.toFixed(2)}x Google`;
}

function labelKey(key: string) {
  return key.split("|").filter(Boolean).join(" / ") || "All deliveries";
}

function sortedAverages(averages: Record<string, DispatchTimingAverage>, limit = 30) {
  return Object.values(averages)
    .sort((left, right) => right.samples - left.samples || left.key.localeCompare(right.key))
    .slice(0, limit);
}

function TimingTable({
  rows,
  title,
  emptyMessage,
}: {
  rows: DispatchTimingAverage[];
  title: string;
  emptyMessage: string;
}) {
  return (
    <section className="panel timingPanel">
      <div>
        <p className="eyebrow">Learned timing</p>
        <h2>{title}</h2>
      </div>
      <div className="timingTable">
        <div className="timingRow timingHeader">
          <span>Group</span>
          <span>Samples</span>
          <span>Actual</span>
          <span>Correction</span>
        </div>
        {rows.map((row) => (
          <div key={row.key} className="timingRow">
            <strong>{labelKey(row.key)}</strong>
            <span>{row.samples}</span>
            <span>{formatMinutes(row.averageActualRoundTripMinutes)}</span>
            <span>{formatFactor(row.averageCorrectionFactor)}</span>
          </div>
        ))}
        {!rows.length ? <p className="muted">{emptyMessage}</p> : null}
      </div>
    </section>
  );
}

export default function TimingPage() {
  const { insights, loadedAt, loadMs } = useLoaderData<typeof loader>();
  const driverRows = sortedAverages(insights.byDriver);
  const driverCityRows = sortedAverages(insights.byDriverCity);
  const globalAverage = insights.globalAverage;

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Route Learning</p>
          <h1>Timing</h1>
          <p className="muted">
            Delivered stops teach the sandbox how actual driver time compares to Google round trips.
          </p>
        </div>
        <div className="topbarActions">
          <PermissionNav />
          <div className="statusBox">
            <strong>{loadMs}ms</strong>
            <span>server load</span>
            <small>{new Date(loadedAt).toLocaleTimeString()}</small>
          </div>
        </div>
      </header>

      <section className="toolbar">
        <div>
          <strong>{insights.sampleCount}</strong>
          <span className="muted"> delivered timing samples recorded</span>
        </div>
        <Form method="get">
          <button type="submit">Refresh Timing</button>
        </Form>
      </section>

      <section className="boardStats">
        <article className="panel compactStat">
          <p className="eyebrow">Actual avg</p>
          <strong>{formatMinutes(globalAverage?.averageActualRoundTripMinutes)}</strong>
          <p className="muted">driver round trip</p>
        </article>
        <article className="panel compactStat">
          <p className="eyebrow">Google avg</p>
          <strong>{formatMinutes(globalAverage?.averageGoogleRoundTripMinutes)}</strong>
          <p className="muted">estimated round trip</p>
        </article>
        <article className="panel compactStat">
          <p className="eyebrow">Correction</p>
          <strong>{formatFactor(globalAverage?.averageCorrectionFactor)}</strong>
          <p className="muted">used when enough samples exist</p>
        </article>
        <article className="panel compactStat">
          <p className="eyebrow">Drivers</p>
          <strong>{driverRows.length}</strong>
          <p className="muted">learned groups</p>
        </article>
        <article className="panel compactStat">
          <p className="eyebrow">City groups</p>
          <strong>{driverCityRows.length}</strong>
          <p className="muted">driver plus city</p>
        </article>
      </section>

      {!insights.sampleCount ? (
        <section className="panel bigEmpty">
          <h2>No learned timing yet</h2>
          <p className="muted">
            Run <code>sql/learned_timing_metrics.sql</code> in Supabase, then mark a few driver stops enroute and delivered.
          </p>
        </section>
      ) : null}

      <section className="timingLayout">
        <TimingTable rows={driverRows} title="By Driver" emptyMessage="No driver averages yet." />
        <TimingTable rows={driverCityRows} title="By Driver And City" emptyMessage="No driver/city averages yet." />
      </section>
    </main>
  );
}
