"use client";

import { FeatureFlow } from "@/components/feature-flow";

import { useEffect, useId, useRef, useState } from "react";
import { Cloud, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, MapPin, Moon, Sun, Thermometer } from "lucide-react";
import {
  CLIMATE_MOVE_M, ClimateController, climateCondition, climateDistanceM, climateIsCurrent, currentClimatePoint,
  type ClimateInput, type ClimatePoint, type ClimateState,
} from "@/lib/live/climate";
import { useLiveTelemetry } from "./live-telemetry-provider";
import { Disclosure } from "./signal-ui";
import styles from "./climate-card.module.css";

function utcTime(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function coordinates(point: ClimatePoint | undefined): string {
  return point ? `${point.latitude.toFixed(4)}°, ${point.longitude.toFixed(4)}°` : "No weather lookup yet";
}

function measurement(value: number | null | undefined, unit: string, digits = 1): string {
  return value === null || value === undefined ? "Unavailable" : `${value.toFixed(digits)}${unit}`;
}

function WeatherIcon({ code, isDay }: { code: number | null; isDay: boolean | null }) {
  const Icon = code === null ? Cloud : code >= 95 ? CloudLightning
    : [71, 73, 75, 77, 85, 86].includes(code) ? CloudSnow
      : code >= 51 ? CloudRain : code >= 45 ? CloudFog : code === 3 ? Cloud
        : code === 2 ? isDay === false ? CloudMoon : isDay === true ? CloudSun : Cloud
          : isDay === false ? Moon : Sun;
  return <Icon size={31} strokeWidth={1.3} aria-hidden="true" />;
}

export function ClimateCard() {
  const { snapshot, capturedSnapshot, status, source, captureEpoch } = useLiveTelemetry();
  const titleId = useId();
  const sourceKey = `${source}:${captureEpoch}`;
  const [weather, setWeather] = useState<ClimateState>({ reading: null, sourceKey: null, loading: false, error: false });
  const [, setClock] = useState(0);
  const controllerRef = useRef<ClimateController | null>(null);
  const inputRef = useRef<ClimateInput>({ snapshot, connected: status === "connected", sourceKey });

  useEffect(() => {
    inputRef.current = { snapshot, connected: status === "connected", sourceKey };
    controllerRef.current?.update(inputRef.current);
  }, [snapshot, status, sourceKey]);

  useEffect(() => {
    const controller = new ClimateController(setWeather);
    controllerRef.current = controller;
    controller.update(inputRef.current);
    const timer = window.setInterval(() => {
      controller.poll();
      setClock(value => value + 1);
    }, 1_000);
    return () => {
      window.clearInterval(timer);
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const now = Date.now();
  const point = currentClimatePoint(snapshot, status === "connected", now);
  const reading = weather.reading;
  const current = weather.sourceKey === sourceKey && climateIsCurrent(reading, point, now);
  const previousLocation = !!reading && !!point && (weather.sourceKey !== sourceKey || climateDistanceM(reading.location, point) >= CLIMATE_MOVE_M);
  const state = current ? "current" : reading ? previousLocation ? "previous-location" : "historical"
    : !point ? "waiting" : weather.error ? "error" : "loading";
  const badge = current ? "Current GPS area" : previousLocation ? "Previous GPS area" : reading ? "Historical estimate"
    : !point ? "Awaiting GPS" : weather.error ? "Unavailable" : "Updating";
  const note = !point ? reading ? "GPS is unavailable. The last weather estimate is retained." : "Nearby weather appears with a fresh GPS fix."
    : previousLocation ? weather.loading ? "Updating weather for the new GPS area." : "Waiting for weather at the new GPS area."
      : weather.error ? "Weather could not be updated. Another attempt will follow."
        : current ? "Modeled outdoor conditions near your latest GPS fix."
          : reading ? weather.loading ? "Updating the last model estimate." : "The last model estimate is no longer current."
            : "Loading modeled weather for your GPS area.";
  const sample = snapshot?.imu.raw ? snapshot : capturedSnapshot;
  const rawTemperature = sample?.imu.raw?.temp;
  const rawAvailable = typeof rawTemperature === "number" && Number.isInteger(rawTemperature) && rawTemperature >= -32768 && rawTemperature <= 32767;

  return <section className={styles.card} aria-labelledby={titleId} data-state={state} data-feature-surface><FeatureFlow offset={2} />
    <div className={styles.header}>
      <h2 id={titleId}>Nearby climate</h2>
      <span className={styles.badge} aria-live="polite"><span aria-hidden="true" />{badge}</span>
    </div>
    <div className={styles.readings}>
      <div className={styles.outdoor}>
        <span className={styles.weatherIcon} aria-hidden="true"><WeatherIcon code={reading?.weatherCode ?? null} isDay={reading?.isDay ?? null} /></span>
        <div className={styles.outdoorCopy}>
          <span className={styles.label}>Outdoor · modeled</span>
          <div className={styles.temperature} aria-label={reading?.temperatureC !== null && reading?.temperatureC !== undefined ? `${reading.temperatureC.toFixed(1)} degrees Celsius` : "Outdoor temperature unavailable"}>
            <strong>{reading?.temperatureC === null || reading?.temperatureC === undefined ? "—" : reading.temperatureC.toFixed(1)}</strong>
            {reading?.temperatureC !== null && reading?.temperatureC !== undefined && <span>°C</span>}
          </div>
          <span className={styles.condition}>{reading ? climateCondition(reading.weatherCode) : "No weather estimate"}</span>
        </div>
      </div>
      <div className={styles.device}>
        <span className={styles.label}><Thermometer size={14} aria-hidden="true" />Device temperature</span>
        <strong>Unavailable</strong>
        <span className={styles.deviceNote}>Sensor conversion unconfirmed</span>
      </div>
    </div>
    <p className={styles.note}><MapPin size={13} aria-hidden="true" /><span>{note}</span></p>
    <Disclosure title="Climate details" className={styles.details}>
      <dl className={styles.facts}>
        <div><dt>GPS area used</dt><dd>{coordinates(reading?.location)}</dd></div>
        <div><dt>Weather grid center</dt><dd>{reading ? `${coordinates(reading.gridLocation)} · ${(climateDistanceM(reading.location, reading.gridLocation) / 1_000).toFixed(1)} km from lookup` : "Unavailable"}</dd></div>
        <div><dt>Model valid at</dt><dd>{utcTime(reading?.validAt)}</dd></div>
        <div><dt>Weather retrieved at</dt><dd>{utcTime(reading?.fetchedAt)}</dd></div>
        <div><dt>Feels like</dt><dd>{measurement(reading?.feelsLikeC, " °C")}</dd></div>
        <div><dt>Relative humidity</dt><dd>{measurement(reading?.humidityPct, "%", 0)}</dd></div>
        <div><dt>Wind at 10 m</dt><dd>{measurement(reading?.windKmh, " km/h")}</dd></div>
        <div><dt>Temperature register</dt><dd>{rawAvailable ? `${rawTemperature} counts` : "Unavailable"}</dd></div>
        <div><dt>Register received at</dt><dd>{rawAvailable ? utcTime(sample?.imu.receivedAt) : "Unavailable"}</dd></div>
      </dl>
      <p className={styles.explanation}>Outdoor conditions come from <a href="https://open-meteo.com/" target="_blank" rel="noreferrer noopener">Open-Meteo</a> weather models, typically at 15-minute intervals. The model grid can differ from the device location. Fresh GPS coordinates are sent to Open-Meteo after about 1 km of movement or 5 minutes.</p>
      <p className={styles.explanation}>The device temperature register is preserved in raw counts. A confirmed sensor conversion is required before it can be shown in °C.</p>
    </Disclosure>
  </section>;
}
