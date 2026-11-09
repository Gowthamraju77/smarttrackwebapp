"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { ArrowDownUp, CircleAlert, Flag, FlaskConical, MapPin, Navigation, Radio, Route } from "lucide-react";
import styles from "./navigation-view.module.css";

type Coordinate = { lat: number; lon: number };
type EndpointErrors = { start?: string; destination?: string };
type ValidatedEndpoints = { start: Coordinate; destination: Coordinate };
type ValidationResult =
  | { valid: true; endpoints: ValidatedEndpoints; errors: EndpointErrors }
  | { valid: false; errors: EndpointErrors };

export type NavigationViewProps = {
  /** Production mode never renders the synthetic-preview controls or data. */
  mode?: "demo" | "production";
};

function parseCoordinate(value: string): Coordinate | string {
  if (!value.trim()) return "Enter coordinates for this endpoint.";
  const parts = value.split(",").map((part) => part.trim());
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  if (parts.length !== 2 || parts.some((part) => !decimal.test(part))) {
    return "Use two decimal numbers separated by a comma: latitude, longitude.";
  }
  const [lat, lon] = parts.map(Number);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return "Latitude must be a finite number between −90 and 90.";
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return "Longitude must be a finite number between −180 and 180.";
  }
  return { lat, lon };
}

export function validateNavigationEndpoints(startValue: string, destinationValue: string): ValidationResult {
  const start = parseCoordinate(startValue);
  const destination = parseCoordinate(destinationValue);
  const errors: EndpointErrors = {};
  if (typeof start === "string") errors.start = start;
  if (typeof destination === "string") errors.destination = destination;
  if (typeof start === "string" || typeof destination === "string") return { valid: false, errors };

  // ±180 identify the same meridian; longitude does not distinguish points at a pole.
  const sameLongitude = start.lon === destination.lon || Math.abs(start.lon - destination.lon) === 360;
  if (start.lat === destination.lat && (sameLongitude || Math.abs(start.lat) === 90)) {
    return { valid: false, errors: { destination: "Choose a destination different from the start." } };
  }
  return { valid: true, endpoints: { start, destination }, errors: {} };
}

function formatCoordinate(coordinate: Coordinate) {
  return `${coordinate.lat}, ${coordinate.lon}`;
}

function SyntheticComparison({ id }: { id: string }) {
  return (
    <figure className={styles.diagram}>
      <div className={styles.legend}>
        <span><i className={styles.plannedLine} aria-hidden="true" />Planned · synthetic</span>
        <span><i className={styles.actualLine} aria-hidden="true" />Actual · synthetic</span>
      </div>
      <svg viewBox="0 0 610 280" role="img" aria-labelledby={`${id}-diagram-title ${id}-diagram-description`}>
        <title id={`${id}-diagram-title`}>Synthetic planned versus actual route comparison</title>
        <desc id={`${id}-diagram-description`}>
          Six invented planned points and four invented actual-track points. Both start at sample A;
          the actual sample ends before sample B and follows a different illustrative path.
          This abstract diagram is unrelated to the entered coordinates and is not a road map.
        </desc>
        <polyline className={styles.plannedPath} points="60,208 152,150 250,168 348,82 450,102 550,40" />
        <polyline className={styles.actualPath} points="60,208 152,150 248,206 348,136" />
        <g className={styles.plannedPoint}>
          <circle cx="250" cy="168" r="4" /><circle cx="348" cy="82" r="4" /><circle cx="450" cy="102" r="4" />
        </g>
        <g className={styles.actualPoint}>
          <circle cx="152" cy="150" r="4" /><circle cx="248" cy="206" r="4" />
          <circle cx="60" cy="208" r="8" /><circle cx="348" cy="136" r="8" />
        </g>
        <circle className={styles.plannedPoint} cx="550" cy="40" r="8" />
        <text x="34" y="244">Sample A</text>
        <text x="514" y="22">Sample B</text>
        <text x="366" y="143">Actual sample end</text>
      </svg>
      <figcaption>Fixed sample paths · not a map · not to scale. Neither path is based on your coordinates or device telemetry.</figcaption>
    </figure>
  );
}

function NavigationWorkspace({ mode }: { mode: "demo" | "production" }) {
  const id = useId();
  const startInput = useRef<HTMLInputElement>(null);
  const destinationInput = useRef<HTMLInputElement>(null);
  const [start, setStart] = useState("");
  const [destination, setDestination] = useState("");
  const [errors, setErrors] = useState<EndpointErrors>({});
  const [endpoints, setEndpoints] = useState<ValidatedEndpoints | null>(null);
  const [previewOptIn, setPreviewOptIn] = useState(false);
  const [message, setMessage] = useState("Enter two distinct endpoints to validate a local route request.");
  const previewEnabled = mode === "demo" && previewOptIn;
  const showPreview = previewEnabled && endpoints !== null;

  function invalidateRequest() {
    setEndpoints(null);
    setErrors({});
    setMessage("Endpoints changed. Validate again to update the local request.");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateNavigationEndpoints(start, destination);
    setErrors(result.errors);
    if (!result.valid) {
      setEndpoints(null);
      setMessage("Check the highlighted endpoint fields.");
      (result.errors.start ? startInput : destinationInput).current?.focus();
      return;
    }
    setEndpoints(result.endpoints);
    setMessage(previewEnabled
      ? "Synthetic comparison shown locally. Your endpoints are valid; no road route has been calculated."
      : "Endpoints are valid. Routing remains unavailable because no routing provider is configured.");
  }

  function clearRequest() {
    setStart("");
    setDestination("");
    setErrors({});
    setEndpoints(null);
    setPreviewOptIn(false);
    setMessage("Local request cleared. Synthetic preview is off.");
    startInput.current?.focus();
  }

  return (
    <div className={styles.view}>
      <header className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>Journey tools</p>
          <h1>Navigation</h1>
          <p className={styles.subtitle}>Prepare endpoints and compare a planned route with an actual track.</p>
        </div>
        <span className={styles.localBadge}><Navigation size={14} aria-hidden="true" />Local workspace</span>
      </header>

      <section className={styles.providerNotice} aria-labelledby={`${id}-provider-title`}>
        <CircleAlert size={20} aria-hidden="true" />
        <div>
          <h2 id={`${id}-provider-title`}>Routing provider unconfigured</h2>
          <p>Road routing, travel estimates and turn-by-turn directions are unavailable. Coordinate validation runs locally.</p>
        </div>
        <span className={styles.unavailableBadge}>Unavailable</span>
      </section>

      <div className={styles.workspace}>
        <section className={styles.panel} aria-labelledby={`${id}-request-title`}>
          <div className={styles.panelHeading}>
            <div><p className={styles.eyebrow}>Route request</p><h2 id={`${id}-request-title`}>Where are you heading?</h2></div>
            <div className={styles.headingIcon}><MapPin size={19} aria-hidden="true" /></div>
          </div>
          <form onSubmit={handleSubmit} noValidate>
            <p className={styles.helper} id={`${id}-coordinate-help`}>
              Use latitude, longitude in decimal degrees. Latitude: −90 to 90. Longitude: −180 to 180.
            </p>
            <div className={styles.field}>
              <label htmlFor={`${id}-start`}><MapPin size={15} aria-hidden="true" />Start coordinates</label>
              <input
                id={`${id}-start`}
                ref={startInput}
                type="text"
                value={start}
                onChange={(event) => { setStart(event.target.value); invalidateRequest(); }}
                placeholder="Latitude, longitude"
                autoComplete="off"
                spellCheck={false}
                maxLength={80}
                required
                aria-invalid={Boolean(errors.start)}
                aria-describedby={`${id}-coordinate-help${errors.start ? ` ${id}-start-error` : ""}`}
              />
              {errors.start && <p className={styles.error} id={`${id}-start-error`}>{errors.start}</p>}
            </div>
            <div className={styles.swapRow}>
              <button
                className={styles.textButton}
                type="button"
                disabled={!start && !destination}
                onClick={() => { setStart(destination); setDestination(start); invalidateRequest(); }}
              ><ArrowDownUp size={14} aria-hidden="true" />Swap start and destination</button>
            </div>
            <div className={styles.field}>
              <label htmlFor={`${id}-destination`}><Flag size={15} aria-hidden="true" />Destination coordinates</label>
              <input
                id={`${id}-destination`}
                ref={destinationInput}
                type="text"
                value={destination}
                onChange={(event) => { setDestination(event.target.value); invalidateRequest(); }}
                placeholder="Latitude, longitude"
                autoComplete="off"
                spellCheck={false}
                maxLength={80}
                required
                aria-invalid={Boolean(errors.destination)}
                aria-describedby={`${id}-coordinate-help${errors.destination ? ` ${id}-destination-error` : ""}`}
              />
              {errors.destination && <p className={styles.error} id={`${id}-destination-error`}>{errors.destination}</p>}
            </div>

            {mode === "demo" && (
              <div className={styles.previewChoice}>
                <label htmlFor={`${id}-preview`}>
                  <input
                    id={`${id}-preview`}
                    type="checkbox"
                    checked={previewOptIn}
                    aria-describedby={`${id}-preview-help`}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setPreviewOptIn(enabled);
                      setEndpoints(null);
                      setMessage(enabled
                        ? "Synthetic preview enabled. Validate endpoints to show the sample comparison."
                        : "Synthetic preview is off. Routing remains unavailable.");
                    }}
                  />
                  <span>Enable synthetic route preview <small>Demo · local only</small></span>
                </label>
                <p id={`${id}-preview-help`}>Opt in to an invented planned path and actual-track sample. The fixed illustration is unrelated to your coordinates.</p>
                {previewEnabled && (
                  <button
                    className={styles.textButton}
                    type="button"
                    onClick={() => {
                      setStart("0, 0");
                      setDestination("0.1, 0.2");
                      setErrors({});
                      setEndpoints(null);
                      setMessage("Synthetic test endpoints filled. Select Show synthetic preview to continue.");
                    }}
                  ><FlaskConical size={14} aria-hidden="true" />Fill synthetic test endpoints</button>
                )}
              </div>
            )}

            <div className={styles.actions}>
              <button className={styles.primaryButton} type="submit"><Route size={16} aria-hidden="true" />{previewEnabled ? "Show synthetic preview" : "Validate endpoints"}</button>
              <button className={styles.secondaryButton} type="button" onClick={clearRequest}>Clear</button>
            </div>
            <p className={styles.formStatus} role="status" aria-live="polite" aria-atomic="true">{message}</p>
          </form>
          <p className={styles.localNote}>Page-local state · resets when this view is closed.</p>
        </section>

        <section className={styles.panel} aria-labelledby={`${id}-comparison-title`}>
          <div className={styles.panelHeading}>
            <div><p className={styles.eyebrow}>Route comparison</p><h2 id={`${id}-comparison-title`}>Planned vs actual</h2></div>
            <span className={showPreview ? styles.syntheticBadge : styles.emptyBadge}>{showPreview ? "Synthetic preview" : "No route data"}</span>
          </div>
          {endpoints && (
            <div className={styles.validatedRequest}>
              <strong>Validated local request</strong>
              <span>Start: {formatCoordinate(endpoints.start)}</span>
              <span>Destination: {formatCoordinate(endpoints.destination)}</span>
            </div>
          )}
          {showPreview ? <SyntheticComparison id={id} /> : (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}><Route size={27} aria-hidden="true" /></div>
              <h3>No route to compare</h3>
              <p>A planned road route needs a routing provider. An actual track needs authenticated GPS telemetry.</p>
              {mode === "demo" && <small>Enable the synthetic preview and validate endpoints to explore a sample comparison.</small>}
            </div>
          )}
          <div className={styles.trackCards}>
            <article className={styles.trackCard}>
              <h3><Route size={16} aria-hidden="true" />Planned route</h3>
              <span className={showPreview ? styles.syntheticBadge : styles.emptyBadge}>{showPreview ? "Synthetic" : "Unavailable"}</span>
              <dl>
                <div><dt>{showPreview ? "Example path" : "Route distance"}</dt><dd>{showPreview ? "6 sample points" : "Unavailable"}</dd></div>
                <div><dt>Travel estimate</dt><dd>Unavailable</dd></div>
              </dl>
              <p>{showPreview ? "Invented geometry for comparison only." : "Routing provider required."}</p>
            </article>
            <article className={`${styles.trackCard} ${styles.actualCard}`}>
              <h3><Radio size={16} aria-hidden="true" />Actual track</h3>
              <span className={showPreview ? styles.syntheticBadge : styles.emptyBadge}>{showPreview ? "Synthetic" : "No telemetry"}</span>
              <dl>
                <div><dt>{showPreview ? "Example path" : "Recorded distance"}</dt><dd>{showPreview ? "4 sample points" : "Unavailable"}</dd></div>
                <div><dt>GPS source</dt><dd>{showPreview ? "None · synthetic" : "Not connected"}</dd></div>
              </dl>
              <p>{showPreview ? "Invented track; no journey was recorded." : "Authenticated GPS telemetry required."}</p>
            </article>
          </div>
          <div className={styles.directionsNote}>
            <Navigation size={18} aria-hidden="true" />
            <div><h3>Turn-by-turn unavailable</h3><p>Directions require a configured routing service and a returned road route.</p></div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function NavigationView({ mode = "demo" }: NavigationViewProps = {}) {
  // A mode change starts a new local workspace, including fresh preview consent.
  return <NavigationWorkspace key={mode} mode={mode} />;
}
