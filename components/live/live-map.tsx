"use client";

import { FeatureFlow } from "@/components/feature-flow";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Box, ChevronDown, ChevronUp, Compass, Crosshair, Expand, MapPin, Maximize2, Minimize2, Minus, Mountain, Plus, RefreshCw, RotateCcw, RotateCw, SlidersHorizontal, X } from "lucide-react";
import type { Map as DeviceMap, Marker, GeoJSONSource } from "maplibre-gl";
import type { LiveSnapshot } from "@/lib/live/telemetry";
import { currentHeading, compassLabel } from "@/lib/live/heading";
import type { LivePoint } from "./live-telemetry-provider";
import { Disclosure, SignalScanner } from "./signal-ui";
import { useSignalStability } from "./signal-filter";
import { useMapTrail } from "./use-map-trail";
import { useJourney } from "./journey-provider";
import styles from "./live-map.module.css";

type Props = { snapshot: LiveSnapshot | null; points: readonly LivePoint[]; connected: boolean; mode?: "tracking" | "planning" | "navigation"; showEvidence?: boolean };
const NO_ROUTES: ReturnType<typeof useJourney>["routes"] = [];

const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const TRAIL_SOURCE = "device-trail";
const BUILDINGS_LAYER = "device-buildings-3d";
const TERRAIN_SOURCE = "measured-terrain";
const PLANNED_SOURCE = "planned-road-route";
const ALTERNATIVES_SOURCE = "road-route-alternatives";
const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const TERRAIN_CREDITS = "https://github.com/tilezen/joerd/blob/master/docs/attribution.md";
const EMPTY_TRAIL = { type: "FeatureCollection" as const, features: [] };
const DEFAULT_ZOOM = 17.25;
const DEFAULT_PITCH = 62;
const DEFAULT_BEARING = -32;
const cameraEase = (value: number) => 1 - Math.pow(1 - value, 3);

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function cameraMotion(duration: number) {
  return { duration: prefersReducedMotion() ? 0 : duration, easing: cameraEase };
}

function validPosition(latitude: number | null, longitude: number | null): boolean {
  return latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

/** Use the nearest copy of a real longitude, including across the date line. */
function longitudeNear(longitude: number, reference: number) {
  return reference + ((longitude - reference + 180) % 360 + 360) % 360 - 180;
}

function continuousCoordinates(points: readonly LivePoint[], reference?: number): [number, number][] {
  return continuousPath(points.map((point) => [point.longitude, point.latitude]), reference);
}

function continuousPath(coordinates: readonly [number, number][], reference?: number): [number, number][] {
  let previous = reference ?? coordinates[0]?.[0] ?? 0;
  return coordinates.map((point) => {
    const longitude = longitudeNear(point[0], previous);
    previous = longitude;
    return [longitude, point[1]];
  });
}

function observationTime(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "Not supplied";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "Not supplied";
}

/** Recolor the provider's geometry; only provider-supplied heights create buildings. */
function prepareMapStyle(map: DeviceMap, perspective: boolean) {
  const style = map.getStyle();
  for (const layer of style.layers) {
    const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;
    if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", "#122f29");
    if (layer.type === "fill") {
      const color = sourceLayer === "water" ? "#153c41"
        : sourceLayer === "building" ? "#355845"
        : sourceLayer === "park" || sourceLayer === "landcover" ? "#204634"
        : sourceLayer === "aeroway" || sourceLayer === "transportation" ? "#3b5847" : "#19392e";
      map.setPaintProperty(layer.id, "fill-color", color);
      if (sourceLayer === "building") map.setPaintProperty(layer.id, "fill-outline-color", "#4f715d");
    }
    if (layer.type === "line") {
      const color = sourceLayer === "waterway" ? "#306069"
        : layer.id.includes("casing") ? "#16362d"
        : layer.id.includes("major") || layer.id.includes("motorway") ? "#93ac9a"
        : sourceLayer === "boundary" ? "#547563" : "#5c7c67";
      map.setPaintProperty(layer.id, "line-color", color);
    }
    if (layer.type === "symbol" && layer.layout?.["text-field"]) {
      map.setPaintProperty(layer.id, "text-color", sourceLayer === "place" ? "#e0eee1" : "#c1d4c3");
      map.setPaintProperty(layer.id, "text-halo-color", "#193b30");
      map.setPaintProperty(layer.id, "text-halo-width", 1.3);
    }
  }

  const labelLayer = style.layers.find((layer) => layer.type === "symbol")?.id;
  const buildingLayer = style.layers.find((layer) => "source-layer" in layer && layer["source-layer"] === "building");
  const buildingSource = buildingLayer && "source" in buildingLayer ? buildingLayer.source : null;
  const hasBuildings = typeof buildingSource === "string" && style.sources[buildingSource]?.type === "vector";
  if (hasBuildings) {
    map.addLayer({
      id: BUILDINGS_LAYER,
      type: "fill-extrusion",
      source: buildingSource,
      "source-layer": "building",
      minzoom: 14,
      // A missing height never becomes an invented building height.
      filter: ["all", [">", ["number", ["get", "render_height"], 0], 0], ["!=", ["get", "hide_3d"], true]],
      layout: { visibility: perspective ? "visible" : "none" },
      paint: {
        "fill-extrusion-color": ["interpolate", ["linear"], ["number", ["get", "render_height"], 0], 0, "#5b8265", 22, "#9ab397", 80, "#d2dac0"],
        "fill-extrusion-height": ["number", ["get", "render_height"], 0],
        "fill-extrusion-base": ["number", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.97,
        "fill-extrusion-vertical-gradient": true,
      },
    }, labelLayer);
    map.setLight({ anchor: "map", color: "#effcda", intensity: 0.56, position: [1.5, 220, 28] });
  }
  map.setSky({ "sky-color": "#142e2a", "horizon-color": "#748d79", "sky-horizon-blend": 0.75, "atmosphere-blend": 0 });

  map.addSource(TRAIL_SOURCE, { type: "geojson", data: EMPTY_TRAIL });
  const beforeTrail = hasBuildings ? BUILDINGS_LAYER : labelLayer;
  map.addLayer({
    id: "device-trail-glow", type: "line", source: TRAIL_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#b5f3cb", "line-width": 11, "line-opacity": 0.16, "line-blur": 3 },
  }, beforeTrail);
  map.addLayer({
    id: "device-trail-line", type: "line", source: TRAIL_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#c4ffda", "line-width": 3.5, "line-opacity": 0.96 },
  }, beforeTrail);
  map.addSource(PLANNED_SOURCE, { type: "geojson", data: EMPTY_TRAIL });
  map.addSource(ALTERNATIVES_SOURCE, { type: "geojson", data: EMPTY_TRAIL });
  map.addLayer({
    id: "planned-route-alternatives", type: "line", source: ALTERNATIVES_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#9ba6c5", "line-width": 4, "line-opacity": 0.48 },
  }, "device-trail-glow");
  map.addLayer({
    id: "planned-route-outline", type: "line", source: PLANNED_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#262c55", "line-width": 8, "line-opacity": 0.8 },
  }, "device-trail-glow");
  map.addLayer({
    id: "planned-route-line", type: "line", source: PLANNED_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#b6b9ff", "line-width": 4, "line-opacity": 0.95, "line-dasharray": [2, 1.5] },
  }, "device-trail-glow");
  return hasBuildings;
}

export function LiveMap({ snapshot, points, connected, mode = "tracking", showEvidence = true }: Props) {
  const stability = useSignalStability();
  const { showTrail, setShowTrail } = useMapTrail();
  const sharedJourney = useJourney();
  const journey = mode === "tracking" ? { ...sharedJourney, start: null, via: null, end: null, route: null, routes: NO_ROUTES, selecting: null, routeStatus: "idle" as const, selectedRouteIndex: null }
    : mode === "navigation" ? { ...sharedJourney, selecting: null, routes: NO_ROUTES } : sharedJourney;
  const modeRef = useRef(mode); modeRef.current = mode;
  const journeyRef = useRef(journey);
  journeyRef.current = journey;
  const titleId = useId();
  const toolsId = useId();
  const cardRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const toolsButtonRef = useRef<HTMLButtonElement | null>(null);
  const zoomReadoutRef = useRef<HTMLOutputElement | null>(null);
  const pitchReadoutRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<DeviceMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const markerFactoryRef = useRef<((point: [number, number], kind?: "device" | "start" | "via" | "end") => Marker) | null>(null);
  const plannedMarkersRef = useRef<{ start: Marker | null; via: Marker | null; end: Marker | null }>({ start: null, via: null, end: null });
  const markerFrameRef = useRef<number | null>(null);
  const markerMovingRef = useRef(false);
  const markerAcceptedRef = useRef<[number, number] | null>(null);
  const markerWasCurrentRef = useRef(false);
  const zoomTargetRef = useRef<number | null>(null);
  const pitchTargetRef = useRef<number | null>(null);
  const bearingTargetRef = useRef<number | null>(null);
  const terrainWantedRef = useRef(false);
  const terrainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPositionRef = useRef<[number, number] | null>(null);
  const cameraRef = useRef<{ center: [number, number]; zoom: number; pitch: number; bearing: number } | null>(null);
  const lastCenterRef = useRef<string | null>(null);
  const followRef = useRef(true);
  const autoFollowRef = useRef(false);
  const perspectiveRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [perspective, setPerspective] = useState(true);
  const [hasBuildings, setHasBuildings] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [cameraSettled, setCameraSettled] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [canFocus, setCanFocus] = useState(false);
  const [focused, setFocused] = useState(false);
  const [toolNotice, setToolNotice] = useState<string | null>(null);
  const [viewMetrics, setViewMetrics] = useState({ zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING });
  const [terrainEnabled, setTerrainEnabled] = useState(false);
  const [terrainStatus, setTerrainStatus] = useState<"off" | "loading" | "ready" | "unavailable">("off");
  const rawLongitude = snapshot?.gps.longitude ?? null;
  const rawLatitude = snapshot?.gps.latitude ?? null;
  const rawUsable = validPosition(rawLatitude, rawLongitude);
  const longitude = stability.gpsPoint?.longitude ?? null;
  const latitude = stability.gpsPoint?.latitude ?? null;
  const usable = validPosition(latitude, longitude);
  const current = usable && rawUsable && connected && snapshot?.status === "live" && snapshot.gps.fix;
  const heading = current ? currentHeading(snapshot, connected) : null;
  const displayPoints = stability.points;
  const captured = useMemo(() => usable ? displayPoints.filter((point) => validPosition(point.latitude, point.longitude)) : [], [displayPoints, usable]);
  const startPoint = journey.start && validPosition(journey.start.latitude, journey.start.longitude) ? journey.start : null;
  const viaPoint = journey.via && validPosition(journey.via.latitude, journey.via.longitude) ? journey.via : null;
  const endPoint = journey.end && validPosition(journey.end.latitude, journey.end.longitude) ? journey.end : null;
  const routeCoordinates = journey.routeStatus === "ready" && journey.route && journey.route.coordinates.length > 1
    && journey.route.coordinates.every((point) => validPosition(point[1], point[0])) ? journey.route.coordinates : null;
  const planning = journey.selecting !== null;
  const mapAvailable = usable || planning || startPoint !== null || viaPoint !== null || endPoint !== null || routeCoordinates !== null;
  const initialContextRef = useRef({ device: usable, plan: startPoint !== null || viaPoint !== null || endPoint !== null || routeCoordinates !== null });
  initialContextRef.current = { device: usable, plan: startPoint !== null || viaPoint !== null || endPoint !== null || routeCoordinates !== null };
  const plannedCenterRef = useRef<string | null>(null);
  const mapPickedRef = useRef<string | null>(null);
  const framedRoutesRef = useRef<{ routes: typeof journey.routes; selected: number | null } | null>(null);
  const [requested, setRequested] = useState(mapAvailable);
  if (usable) initialPositionRef.current = [longitude!, latitude!];
  else if (startPoint) initialPositionRef.current = [startPoint.longitude, startPoint.latitude];
  else if (viaPoint) initialPositionRef.current = [viaPoint.longitude, viaPoint.latitude];
  else if (endPoint) initialPositionRef.current = [endPoint.longitude, endPoint.latitude];
  else if (routeCoordinates) initialPositionRef.current = routeCoordinates[0];
  else if (planning) initialPositionRef.current = [0, 15]; // Neutral world overview, never a device position.

  useEffect(() => { if (mapAvailable) setRequested(true); }, [mapAvailable]);

  useEffect(() => {
    setCanFocus(Boolean(document.fullscreenEnabled && cardRef.current?.requestFullscreen));
    const changed = () => setFocused(document.fullscreenElement === cardRef.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  useEffect(() => {
    if (!toolsOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !toolsRef.current?.contains(event.target) && !toolsButtonRef.current?.contains(event.target)) setToolsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setToolsOpen(false); toolsButtonRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [toolsOpen]);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && journeyRef.current.selecting) journeyRef.current.setSelecting(null);
    };
    document.addEventListener("keydown", cancel);
    return () => document.removeEventListener("keydown", cancel);
  }, []);

  // Keep the same map through normal fixes, freshness changes, and feed pauses.
  // A user-requested retry is the only reason to rebuild a mounted map.
  useEffect(() => {
    if (!requested || !containerRef.current) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let resizeFrame = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stopMotion = () => {
      if (!motionPreference.matches) return;
      mapRef.current?.stop();
      if (markerFrameRef.current !== null) cancelAnimationFrame(markerFrameRef.current);
      markerFrameRef.current = null;
      markerMovingRef.current = false;
      if (markerAcceptedRef.current) markerRef.current?.setLngLat(markerAcceptedRef.current);
    };
    motionPreference.addEventListener("change", stopMotion);
    setReady(false);
    setMapError(null);
    setHasBuildings(false);

    void import("maplibre-gl").then((maplibre) => {
      if (disposed || !containerRef.current || !initialPositionRef.current) return;
      const savedCamera = cameraRef.current;
      const initialContext = initialContextRef.current;
      const map = new maplibre.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: savedCamera?.center ?? initialPositionRef.current,
        zoom: savedCamera?.zoom ?? (initialContext.device ? DEFAULT_ZOOM : initialContext.plan ? 14.25 : 1.6),
        pitch: savedCamera?.pitch ?? (initialContext.device && perspectiveRef.current ? DEFAULT_PITCH : 0),
        bearing: savedCamera?.bearing ?? (initialContext.device ? DEFAULT_BEARING : 0),
        maxPitch: 74,
        zoomSnap: 0.25,
        canvasContextAttributes: { antialias: true },
        attributionControl: false,
        cooperativeGestures: true,
        fadeDuration: prefersReducedMotion() ? 0 : 200,
      });
      mapRef.current = map;
      markerFactoryRef.current = (point, kind = "device") => {
        const element = document.createElement("div");
        element.className = kind === "device" ? styles.deviceMarker : `${styles.plannedMarker} ${kind === "start" ? styles.startMarker : kind === "via" ? styles.viaMarker : styles.endMarker}`;
        element.setAttribute("role", "img");
        element.setAttribute("aria-label", kind === "device" ? "ESP32 reported location" : kind === "start" ? "Planned start" : kind === "via" ? "Planned via place" : "Planned destination");
        if (kind === "device") { const arrow = document.createElement("span"); arrow.className = styles.pointerShape; arrow.setAttribute("aria-hidden", "true"); element.append(arrow); }
        if (kind !== "device") element.textContent = kind === "start" ? "S" : kind === "via" ? "V" : "E";
        return new maplibre.Marker({ element, anchor: "center" }).setLngLat(point).addTo(map);
      };
      map.setVerticalFieldOfView(42);
      map.addControl(new maplibre.AttributionControl({ compact: false }), "bottom-right");
      map.addControl(new maplibre.ScaleControl({ unit: "metric", maxWidth: 80 }), "bottom-left");
      map.getCanvas().setAttribute("aria-label", "Device street map. Use arrow keys to pan and plus or minus to zoom.");

      let encounteredError = false;
      map.on("error", (event) => {
        if (disposed) return;
        const detail = event.error as (Error & { url?: string }) | undefined;
        const sourceId = (event as typeof event & { sourceId?: string }).sourceId;
        if (sourceId === TERRAIN_SOURCE || detail?.url?.includes("elevation-tiles-prod") || detail?.message?.includes("elevation-tiles-prod")) {
          terrainUnavailable(map);
          return;
        }
        encounteredError = true;
        setMapError("Some street detail could not load. Check your connection and retry the map.");
      });
      map.on("sourcedata", (event) => {
        const tile = (event as typeof event & { tile?: { state?: string; dem?: unknown } }).tile;
        if (!disposed && terrainWantedRef.current && event.sourceId === TERRAIN_SOURCE && tile?.state === "loaded" && tile.dem) {
          if (terrainTimerRef.current) clearTimeout(terrainTimerRef.current);
          terrainTimerRef.current = null;
          setTerrainStatus("ready");
        }
      });
      map.on("click", (event) => {
        if (disposed) return;
        const plan = journeyRef.current;
        if (modeRef.current === "planning" && plan.selecting) {
          const point = event.lngLat.wrap();
          if (validPosition(point.lat, point.lng)) {
            mapPickedRef.current = `${plan.selecting}:${point.lng},${point.lat}`;
            plan.choosePoint({ latitude: point.lat, longitude: point.lng });
          }
          return;
        }
        if (modeRef.current !== "planning" || (plan.phase !== "idle" && plan.phase !== "finished") || !map.getLayer("planned-route-alternatives")) return;
        const hit = map.queryRenderedFeatures(event.point, { layers: ["planned-route-line", "planned-route-alternatives"] })[0];
        if (hit?.layer.id !== "planned-route-alternatives") return;
        const index = Number(hit.properties.routeIndex);
        if (Number.isInteger(index) && index >= 0 && index < plan.routes.length) plan.selectRoute(index);
      });
      map.on("mousemove", (event) => {
        if (disposed) return;
        const plan = journeyRef.current;
        if (plan.selecting) { map.getCanvas().style.cursor = "crosshair"; return; }
        const canSelect = modeRef.current === "planning" && (plan.phase === "idle" || plan.phase === "finished") && plan.routes.length > 1 && map.getLayer("planned-route-alternatives");
        const hit = canSelect && map.queryRenderedFeatures(event.point, { layers: ["planned-route-alternatives"] }).length > 0;
        map.getCanvas().style.cursor = hit ? "pointer" : "";
      });
      map.on("movestart", (event) => {
        if (!disposed && event.originalEvent) {
          zoomTargetRef.current = null;
          pitchTargetRef.current = null;
          bearingTargetRef.current = null;
          followRef.current = false;
          setFollow(false);
        }
      });
      const updateReadouts = () => {
        if (zoomReadoutRef.current) zoomReadoutRef.current.textContent = map.getZoom().toFixed(2);
        if (pitchReadoutRef.current) pitchReadoutRef.current.textContent = `${Math.round(map.getPitch())}°`;
      };
      map.on("zoom", updateReadouts);
      map.on("pitch", updateReadouts);
      map.on("zoomend", () => { zoomTargetRef.current = null; });
      map.on("rotateend", () => { bearingTargetRef.current = null; });
      map.on("moveend", () => {
        if (disposed) return;
        autoFollowRef.current = false;
        updateReadouts();
        setViewMetrics({ zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() });
        setCameraSettled((version) => version + 1);
      });
      map.on("pitchend", () => {
        if (disposed) return;
        pitchTargetRef.current = null;
        const next = map.getPitch() > 5;
        perspectiveRef.current = next;
        setPerspective(next);
      });
      map.on("style.load", () => {
        if (disposed) return;
        try {
          setHasBuildings(prepareMapStyle(map, perspectiveRef.current));
        } catch {
          encounteredError = true;
          setMapError("The map could not finish loading. Retry to reopen it.");
        }
      });
      map.on("load", () => {
        if (disposed) return;
        clearTimeout(timeout);
        if (!encounteredError) setMapError(null);
        setViewMetrics({ zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() });
        perspectiveRef.current = map.getPitch() > 5;
        setPerspective(perspectiveRef.current);
        setReady(true);
      });
      timeout = setTimeout(() => {
        if (!disposed && !map.loaded()) setMapError("The map is taking longer than expected. Check your connection and try again.");
      }, 20_000);
      observer = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => { if (!disposed) map.resize(); });
      });
      observer.observe(containerRef.current);
    }).catch(() => {
      if (!disposed) setMapError("This browser could not open the 3D map. Try enabling hardware acceleration or using another browser.");
    });

    return () => {
      disposed = true;
      motionPreference.removeEventListener("change", stopMotion);
      clearTimeout(timeout);
      cancelAnimationFrame(resizeFrame);
      observer?.disconnect();
      if (terrainTimerRef.current) clearTimeout(terrainTimerRef.current);
      terrainTimerRef.current = null;
      if (markerFrameRef.current !== null) cancelAnimationFrame(markerFrameRef.current);
      markerFrameRef.current = null;
      markerMovingRef.current = false;
      markerAcceptedRef.current = null;
      markerWasCurrentRef.current = false;
      zoomTargetRef.current = null;
      pitchTargetRef.current = null;
      bearingTargetRef.current = null;
      markerRef.current?.remove();
      markerRef.current = null;
      plannedMarkersRef.current.start?.remove();
      plannedMarkersRef.current.via?.remove();
      plannedMarkersRef.current.end?.remove();
      plannedMarkersRef.current = { start: null, via: null, end: null };
      markerFactoryRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      lastCenterRef.current = null;
      autoFollowRef.current = false;
      plannedCenterRef.current = null;
      framedRoutesRef.current = null;
    };
  }, [requested, retryVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (planning) { followRef.current = false; setFollow(false); map.stop(); }
    map.getCanvas().style.cursor = planning ? "crosshair" : "";
    map.getCanvas().setAttribute("aria-label", planning ? `Choose journey ${journey.selecting === "start" ? "start" : journey.selecting === "via" ? "via place" : "destination"}. Use arrow keys to pan, then choose Use map center.` : "Device street map. Use arrow keys to pan and plus or minus to zoom.");
  }, [ready, planning, journey.selecting]);

  useEffect(() => {
    if (!ready || !markerFactoryRef.current) return;
    const planned = { start: startPoint, via: viaPoint, end: endPoint };
    for (const kind of ["start", "via", "end"] as const) {
      const point = planned[kind];
      const existing = plannedMarkersRef.current[kind];
      if (point) {
        if (existing) existing.setLngLat([point.longitude, point.latitude]);
        else plannedMarkersRef.current[kind] = markerFactoryRef.current([point.longitude, point.latitude], kind);
      } else { existing?.remove(); plannedMarkersRef.current[kind] = null; }
    }
  }, [ready, startPoint?.latitude, startPoint?.longitude, viaPoint?.latitude, viaPoint?.longitude, endPoint?.latitude, endPoint?.longitude]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || planning || (journey.phase !== "idle" && journey.phase !== "finished")) return;
    const key = `${startPoint?.longitude},${startPoint?.latitude}:${viaPoint?.longitude},${viaPoint?.latitude}:${endPoint?.longitude},${endPoint?.latitude}`;
    if (plannedCenterRef.current === key) return;
    plannedCenterRef.current = key;
    const picked = mapPickedRef.current;
    mapPickedRef.current = null;
    if (picked && (picked === `start:${startPoint?.longitude},${startPoint?.latitude}` || picked === `via:${viaPoint?.longitude},${viaPoint?.latitude}` || picked === `end:${endPoint?.longitude},${endPoint?.latitude}`)) return;
    const selectedPoints = [startPoint, viaPoint, endPoint].filter(point => point !== null);
    if (selectedPoints.length > 1) fitCoordinates(continuousPath(selectedPoints.map(point => [point.longitude, point.latitude]), map.getCenter().lng));
    else {
      const point = startPoint ?? viaPoint ?? endPoint;
      if (!point) return;
      pauseFollowing();
      map.easeTo({ center: [longitudeNear(point.longitude, map.getCenter().lng), point.latitude], zoom: 14.25, ...cameraMotion(840) });
    }
  }, [ready, planning, journey.phase, startPoint?.latitude, startPoint?.longitude, viaPoint?.latitude, viaPoint?.longitude, endPoint?.latitude, endPoint?.longitude]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || planning || journey.routeStatus !== "ready" || !journey.routes.length || (journey.phase !== "idle" && journey.phase !== "finished")) return;
    const previous = framedRoutesRef.current;
    if (previous?.routes === journey.routes && previous.selected === journey.selectedRouteIndex) return;
    framedRoutesRef.current = { routes: journey.routes, selected: journey.selectedRouteIndex };
    const routes = journey.route ? [journey.route] : journey.routes;
    fitCoordinates(routes.flatMap(route => continuousPath(route.coordinates, map.getCenter().lng)));
  }, [ready, planning, journey.routes, journey.route, journey.selectedRouteIndex, journey.routeStatus, journey.phase]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const source = map.getSource(PLANNED_SOURCE) as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: routeCoordinates ? [{
      type: "Feature", properties: { planned: true }, geometry: { type: "LineString", coordinates: continuousPath(routeCoordinates) },
    }] : [] });
    if (map.getLayer("planned-route-line")) map.setPaintProperty("planned-route-line", "line-dasharray", journey.phase === "active" ? [1, 0] : [2, 1.5]);
  }, [ready, routeCoordinates, journey.phase]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const source = map.getSource(ALTERNATIVES_SOURCE) as GeoJSONSource | undefined;
    const options = journey.routeStatus === "ready" ? journey.routes : [];
    source?.setData({ type: "FeatureCollection", features: options.flatMap((route, index) =>
      index === journey.selectedRouteIndex || route.coordinates.length < 2 || !route.coordinates.every((point) => validPosition(point[1], point[0])) ? [] : [{
        type: "Feature" as const, properties: { routeIndex: index }, geometry: { type: "LineString" as const, coordinates: continuousPath(route.coordinates) },
      }]) });
    if (map.getLayer("planned-route-alternatives")) map.setPaintProperty("planned-route-alternatives", "line-opacity", journey.phase === "active" ? 0.22 : 0.48);
  }, [ready, journey.routes, journey.routeStatus, journey.selectedRouteIndex, journey.phase]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (terrainTimerRef.current) clearTimeout(terrainTimerRef.current);
    terrainTimerRef.current = null;
    if (!terrainEnabled) {
      try {
        if (map.getTerrain()) map.setTerrain(null);
        if (map.getSource(TERRAIN_SOURCE)) map.removeSource(TERRAIN_SOURCE);
      } catch { /* A failed optional elevation layer must not replace the street map. */ }
      return;
    }
    setTerrainStatus("loading");
    try {
      if (!map.getSource(TERRAIN_SOURCE)) map.addSource(TERRAIN_SOURCE, {
        type: "raster-dem", tiles: [TERRAIN_TILES], tileSize: 256, maxzoom: 15, encoding: "terrarium",
        attribution: `Terrain: <a href="${TERRAIN_CREDITS}" target="_blank" rel="noopener noreferrer">Mapzen / source credits</a>`,
      });
      map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: 1 });
      terrainTimerRef.current = setTimeout(() => terrainUnavailable(map), 20_000);
    } catch { terrainUnavailable(map); }
    return () => { if (terrainTimerRef.current) clearTimeout(terrainTimerRef.current); terrainTimerRef.current = null; };
  }, [ready, terrainEnabled]);

  useEffect(() => {
    if (!ready) return;
    if (!usable) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current && latitude !== null && longitude !== null && markerFactoryRef.current) {
      markerRef.current = markerFactoryRef.current([longitude, latitude]);
    }
    const element = markerRef.current?.getElement();
    if (element) {
      element.hidden = !usable;
      element.classList.toggle(styles.staleMarker, !current);
      element.classList.toggle(styles.directionalMarker, heading !== null);
      element.dataset.heading = heading === null ? "unavailable" : String(heading);
      markerRef.current?.setRotationAlignment(heading === null ? "viewport" : "map").setPitchAlignment(heading === null ? "viewport" : "map").setRotation(heading ?? 0);
      element.title = heading === null ? "Travel direction unavailable" : `GPS travel direction ${Math.round(heading)}° ${compassLabel(heading)}`;
      element.setAttribute("aria-label", current ? "Current ESP32 GPS fix" : "Last known ESP32 position, not current");
    }
  }, [ready, usable, current, latitude, longitude, heading]);

  useEffect(() => {
    const marker = markerRef.current;
    const interrupted = markerMovingRef.current;
    if (markerFrameRef.current !== null) cancelAnimationFrame(markerFrameRef.current);
    markerFrameRef.current = null;
    markerMovingRef.current = false;
    if (!ready || !marker) { markerAcceptedRef.current = null; markerWasCurrentRef.current = false; return; }
    if (!usable || latitude === null || longitude === null) {
      markerAcceptedRef.current = null;
      markerWasCurrentRef.current = false;
      return;
    }
    const previous = markerAcceptedRef.current;
    const target: [number, number] = [longitude, latitude];
    const canAnimate = current && markerWasCurrentRef.current && previous && !interrupted && !prefersReducedMotion()
      && (previous[0] !== longitude || previous[1] !== latitude);
    markerAcceptedRef.current = target;
    markerWasCurrentRef.current = current;
    if (!canAnimate || !previous) { marker.setLngLat(target); return; }

    const nearLongitude = longitudeNear(longitude, previous[0]);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const start = performance.now();
    markerMovingRef.current = true;
    // This is a short visual transition between two accepted samples, never a prediction.
    const animate = (now: number) => {
      const progress = reducedMotion.matches ? 1 : Math.min(1, Math.max(0, (now - start) / 580));
      const eased = progress * progress * (3 - 2 * progress);
      marker.setLngLat([previous[0] + (nearLongitude - previous[0]) * eased, previous[1] + (latitude - previous[1]) * eased]);
      if (progress < 1) markerFrameRef.current = requestAnimationFrame(animate);
      else { marker.setLngLat(target); markerFrameRef.current = null; markerMovingRef.current = false; }
    };
    markerFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (markerFrameRef.current !== null) cancelAnimationFrame(markerFrameRef.current);
      markerFrameRef.current = null;
    };
  }, [ready, latitude, longitude, usable, current]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!current && autoFollowRef.current) { map.stop(); autoFollowRef.current = false; }
    if (!usable || latitude === null || longitude === null) return;
    const centerKey = `${longitude},${latitude}`;
    if (follow && followRef.current && (!map.isMoving() || autoFollowRef.current) && lastCenterRef.current !== centerKey) {
      lastCenterRef.current = centerKey;
      autoFollowRef.current = true;
      // Retarget only our own follow transition; gestures and view controls retain priority.
      map.easeTo({ center: [longitudeNear(longitude, map.getCenter().lng), latitude], easeId: "device-follow", ...cameraMotion(current ? 620 : 0) });
    }
  }, [ready, latitude, longitude, usable, current, follow, cameraSettled]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const source = map.getSource(TRAIL_SOURCE) as GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: captured.length > 1 ? [{
        type: "Feature", properties: {},
        geometry: { type: "LineString", coordinates: continuousCoordinates(captured) },
      }] : [],
    });
  }, [ready, captured]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const layer of ["device-trail-line", "device-trail-glow"]) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", showTrail ? "visible" : "none");
    }
  }, [ready, showTrail]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (map.getLayer("device-trail-line")) {
      map.setPaintProperty("device-trail-line", "line-color", current ? "#c4ffda" : "#d5c5a4");
      map.setPaintProperty("device-trail-line", "line-dasharray", current ? [1, 0] : [1.5, 1.5]);
      map.setPaintProperty("device-trail-glow", "line-color", current ? "#b5f3cb" : "#d5c5a4");
    }
  }, [ready, current]);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map?.getLayer(BUILDINGS_LAYER)) map.setLayoutProperty(BUILDINGS_LAYER, "visibility", perspective ? "visible" : "none");
  }, [ready, perspective]);

  function pauseFollowing() {
    followRef.current = false;
    setFollow(false);
  }

  function followDevice() {
    const next = !followRef.current;
    followRef.current = next;
    lastCenterRef.current = null;
    setFollow(next);
    if (!next) mapRef.current?.stop();
  }

  function changeView(next: boolean) {
    const map = mapRef.current;
    if (!map) return;
    map.stop();
    perspectiveRef.current = next;
    setPerspective(next);
    map.easeTo({ pitch: next ? DEFAULT_PITCH : 0, bearing: next ? map.getBearing() || DEFAULT_BEARING : 0, ...cameraMotion(760) });
  }

  function zoom(amount: number) {
    const map = mapRef.current;
    if (!map) return;
    const origin = map.isZooming() && zoomTargetRef.current !== null ? zoomTargetRef.current : map.getZoom();
    zoomToLevel(Math.round((origin + amount) * 100) / 100);
  }

  function zoomToLevel(level: number) {
    const map = mapRef.current;
    if (!map) return;
    pauseFollowing();
    const target = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), level));
    const duration = Math.min(840, 300 + Math.abs(target - map.getZoom()) * 110);
    map.easeTo({ zoom: target, easeId: "map-zoom", ...cameraMotion(duration) });
    zoomTargetRef.current = map.isZooming() ? target : null;
  }

  function tiltBy(amount: number) {
    const map = mapRef.current;
    if (!map) return;
    pauseFollowing();
    const origin = map.isMoving() && pitchTargetRef.current !== null ? pitchTargetRef.current : map.getPitch();
    const pitch = Math.max(0, Math.min(74, origin + amount));
    map.easeTo({ pitch, easeId: "map-tilt", ...cameraMotion(420) });
    pitchTargetRef.current = map.isMoving() ? pitch : null;
    perspectiveRef.current = pitch > 5;
    setPerspective(perspectiveRef.current);
  }

  function rotateBy(amount: number) {
    const map = mapRef.current;
    if (!map) return;
    pauseFollowing();
    const origin = map.isMoving() && bearingTargetRef.current !== null ? bearingTargetRef.current : map.getBearing();
    const bearing = origin + amount;
    map.easeTo({ bearing, easeId: "map-rotate", ...cameraMotion(420) });
    bearingTargetRef.current = map.isMoving() ? bearing : null;
  }

  function terrainUnavailable(map: DeviceMap) {
    if (mapRef.current !== map) return;
    terrainWantedRef.current = false;
    if (terrainTimerRef.current) clearTimeout(terrainTimerRef.current);
    terrainTimerRef.current = null;
    setTerrainEnabled(false);
    setTerrainStatus("unavailable");
    try { if (map.getTerrain()) map.setTerrain(null); } catch { /* Preserve the street map if optional terrain fails. */ }
  }

  function toggleTerrain() {
    const next = !terrainWantedRef.current;
    terrainWantedRef.current = next;
    setTerrainEnabled(next);
    setTerrainStatus(next ? "loading" : "off");
    if (next && (mapRef.current?.getPitch() ?? 0) < 20) changeView(true);
  }

  function useMapCenter() {
    const map = mapRef.current;
    if (!map || !journeyRef.current.selecting) return;
    const point = map.getCenter().wrap();
    if (validPosition(point.lat, point.lng)) {
      mapPickedRef.current = `${journeyRef.current.selecting}:${point.lng},${point.lat}`;
      journeyRef.current.choosePoint({ latitude: point.lat, longitude: point.lng });
    }
    map.getCanvas().focus();
  }

  function fitTrail() {
    const map = mapRef.current;
    if (!map || !usable || longitude === null || latitude === null) return;
    const coordinates = captured.length ? continuousCoordinates(captured, map.getCenter().lng) : [[longitudeNear(longitude, map.getCenter().lng), latitude]];
    fitCoordinates(coordinates as [number, number][]);
  }

  function fitPlannedRoute() {
    const map = mapRef.current;
    if (map && routeCoordinates) fitCoordinates(continuousPath(routeCoordinates, map.getCenter().lng));
  }

  function fitCoordinates(coordinates: [number, number][]) {
    const map = mapRef.current;
    if (!map || coordinates.length === 0) return;
    const west = Math.min(...coordinates.map((point) => point[0]));
    const east = Math.max(...coordinates.map((point) => point[0]));
    const south = Math.min(...coordinates.map((point) => point[1]));
    const north = Math.max(...coordinates.map((point) => point[1]));
    const width = containerRef.current?.clientWidth ?? 500;
    const height = containerRef.current?.clientHeight ?? 400;
    const horizontal = Math.min(70, width * 0.12);
    const vertical = Math.min(85, height * 0.17);
    pauseFollowing();
    map.stop();
    perspectiveRef.current = false;
    setPerspective(false);
    map.fitBounds([[west, south], [east, north]], {
      padding: { top: vertical, bottom: vertical + 45, left: horizontal, right: horizontal + 32 },
      maxZoom: 18.25, pitch: 0, bearing: 0, linear: true,
      ...cameraMotion(900),
    });
  }

  function resetView() {
    const map = mapRef.current;
    if (!map) return;
    const origin: [number, number] = usable && longitude !== null && latitude !== null ? [longitude, latitude]
      : startPoint ? [startPoint.longitude, startPoint.latitude] : viaPoint ? [viaPoint.longitude, viaPoint.latitude] : endPoint ? [endPoint.longitude, endPoint.latitude] : [0, 15];
    map.stop();
    perspectiveRef.current = usable;
    followRef.current = usable && !planning;
    lastCenterRef.current = usable ? `${longitude},${latitude}` : null;
    setPerspective(usable);
    setFollow(followRef.current);
    map.easeTo({ center: [longitudeNear(origin[0], map.getCenter().lng), origin[1]], zoom: usable ? DEFAULT_ZOOM : startPoint || viaPoint || endPoint ? 14.25 : 1.6, pitch: usable ? DEFAULT_PITCH : 0, bearing: usable ? DEFAULT_BEARING : 0, ...cameraMotion(820) });
  }

  function focusMap() {
    const card = cardRef.current;
    if (!card) return;
    setToolNotice(null);
    const request = document.fullscreenElement === card ? document.exitFullscreen() : card.requestFullscreen();
    void request.catch(() => setToolNotice("Focus view is unavailable in this browser."));
  }

  function retryMap() {
    const map = mapRef.current;
    if (map) cameraRef.current = { center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    setRetryVersion((version) => version + 1);
  }

  return <section ref={cardRef} className={styles.mapCard} aria-labelledby={titleId} data-map-focused={focused} data-map-mode={mode}>
    <div className={styles.cardHeader} data-feature-surface><FeatureFlow tone="dark" offset={1} />
      <div className={styles.heading}><span className={styles.headerIcon}><MapPin size={19} aria-hidden="true" /></span><div><p className={styles.eyebrow}>Spatial tracking</p><h2 id={titleId}>{planning ? journey.selecting === "start" ? "Choose start" : journey.selecting === "via" ? "Choose via place" : "Choose destination" : current ? "Live position" : usable ? "Last known position" : mapAvailable ? "Journey overview" : "Your device, in view"}</h2></div></div>
      <span className={`${styles.status} ${current ? styles.liveStatus : usable ? styles.capturedStatus : ""}`}><span aria-hidden="true" />{current ? "GPS live" : usable ? "Captured" : mapAvailable ? "Planning" : "No fix"}</span>
    </div>
    <div className={styles.mapFrame} data-map-view={perspective ? "3d" : "2d"} data-map-ready={ready} data-map-zoom={viewMetrics.zoom.toFixed(2)} data-map-pitch={Math.round(viewMetrics.pitch)} data-map-bearing={Math.round(viewMetrics.bearing)} data-map-terrain={terrainStatus} data-map-context={usable ? "device" : "planning"} data-position-held={stability.gpsHeld} data-map-follow={usable && follow} data-location-display={showTrail ? "trail" : "location"}>
      <div ref={containerRef} className={`${styles.mapCanvas} ${!mapAvailable ? styles.hiddenMap : ""}`} inert={!mapAvailable || !ready} aria-hidden={!mapAvailable} />
      <div className={styles.vignette} aria-hidden="true" />
      {mapAvailable && ready && <>
        <div className={styles.topHud}>
          {usable ? <div className={`${styles.modeToggle} ${styles.trailToggle}`} role="group" aria-label="Location display">
            <button type="button" aria-pressed={!showTrail} onClick={() => setShowTrail(false)}>Location only</button>
            <button type="button" aria-pressed={showTrail} onClick={() => setShowTrail(true)}>Location + trail</button>
          </div> : <span className={styles.planningLabel}><MapPin size={13} aria-hidden="true" />Journey planning</span>}
          <div className={styles.viewToggle} role="group" aria-label="Map view"><button type="button" aria-pressed={!perspective} onClick={() => changeView(false)}>2D</button><button type="button" aria-pressed={perspective} onClick={() => changeView(true)}>3D</button></div>
        </div>
        {!planning && <div className={styles.viewLabel}><Box size={13} aria-hidden="true" /><span>{perspective ? "Spatial view" : "Overhead"}<small><b ref={pitchReadoutRef}>{Math.round(viewMetrics.pitch)}°</b> pitch</small>{terrainStatus === "ready" && <small>Terrain · 1×</small>}<small className={styles.headingReadout} aria-label="GPS travel direction">{heading === null ? "Heading unavailable" : `${Math.round(heading)}° ${compassLabel(heading)} · GPS heading`}</small></span></div>}
        {planning && <div className={styles.selectionPrompt} role="status"><strong>{journey.selecting === "start" ? "Place your start point" : journey.selecting === "via" ? "Place your via point" : "Place your destination"}</strong><span>Tap the map or use its center.</span><div><button type="button" onClick={useMapCenter}>Use map center</button><button type="button" aria-label="Cancel point selection" title="Cancel point selection" onClick={() => journey.setSelecting(null)}><X size={15} aria-hidden="true" /></button></div></div>}
        <div className={styles.reticle} aria-hidden="true"><i /><i /><i /><i />{!follow && <span>MAP CENTER</span>}</div>
        <div className={styles.navigation} role="group" aria-label="Map controls">
          <button type="button" aria-label="Zoom in" title="Zoom in by 0.25" onClick={() => zoom(0.25)}><Plus size={18} aria-hidden="true" /></button>
          <div className={styles.zoomReadout}><span>ZOOM</span><output ref={zoomReadoutRef} aria-label="Map zoom" aria-live="off">{viewMetrics.zoom.toFixed(2)}</output><i aria-hidden="true" /></div>
          <button type="button" aria-label="Zoom out" title="Zoom out by 0.25" onClick={() => zoom(-0.25)}><Minus size={18} aria-hidden="true" /></button>
        </div>
        <div className={styles.bottomHud}>
          <div className={styles.legends}>{showTrail && captured.length > 1 && <span className={`${styles.trailLegend} ${!current ? styles.historicalTrail : ""}`}><span aria-hidden="true" />Captured trail</span>}{journey.routeStatus === "ready" && journey.routes.length > 0 && <span className={`${styles.trailLegend} ${styles.plannedLegend}`}><span aria-hidden="true" />{routeCoordinates ? "Selected road" : "Road options"}</span>}</div>
          <div className={styles.controlDock}>
            <button className={`${styles.followButton} ${usable && follow ? styles.following : ""}`} type="button" disabled={!usable || planning} aria-pressed={usable && follow} onClick={followDevice}><Crosshair size={15} aria-hidden="true" />{usable && follow ? "Following device" : "Follow device"}</button>
            {showTrail && <button className={styles.dockButton} type="button" disabled={!usable || planning} aria-label="Fit captured trail" title="Fit captured trail" onClick={fitTrail}><Expand size={18} aria-hidden="true" /></button>}
            <button ref={toolsButtonRef} className={styles.dockButton} type="button" aria-label="Map tools" title="Map tools" aria-expanded={toolsOpen} aria-controls={toolsId} onClick={() => setToolsOpen((open) => !open)}><SlidersHorizontal size={17} aria-hidden="true" /></button>
          </div>
          {toolsOpen && <div ref={toolsRef} id={toolsId} className={styles.toolsPanel} role="group" aria-label="Additional map controls">
            <p>Frame your view</p>
            <div className={styles.zoomPresets} role="group" aria-label="Map zoom presets">{([{ label: "Area", zoom: 14.25 }, { label: "Street", zoom: DEFAULT_ZOOM }, { label: "Detail", zoom: 19.25 }]).map((preset) => <button type="button" key={preset.label} aria-label={`Zoom to ${preset.label.toLowerCase()}`} aria-pressed={Math.abs(viewMetrics.zoom - preset.zoom) < 0.1} onClick={() => zoomToLevel(preset.zoom)}>{preset.label}</button>)}</div>
            <div className={styles.attitudeControls}>
              <div role="group" aria-label="Map tilt"><button type="button" aria-label="Tilt less" title="Reduce tilt by 10 degrees" onClick={() => tiltBy(-10)}><ChevronDown size={16} aria-hidden="true" /></button><span>Tilt <b>{Math.round(viewMetrics.pitch)}°</b></span><button type="button" aria-label="Tilt more" title="Increase tilt by 10 degrees" onClick={() => tiltBy(10)}><ChevronUp size={16} aria-hidden="true" /></button></div>
              <div role="group" aria-label="Map rotation"><button type="button" aria-label="Rotate left" title="Rotate left by 15 degrees" onClick={() => rotateBy(-15)}><RotateCcw size={14} aria-hidden="true" /></button><span>Rotate <b>{Math.round(viewMetrics.bearing)}°</b></span><button type="button" aria-label="Rotate right" title="Rotate right by 15 degrees" onClick={() => rotateBy(15)}><RotateCw size={14} aria-hidden="true" /></button></div>
            </div>
            <button type="button" className={styles.terrainControl} aria-label="Terrain elevation" aria-pressed={terrainEnabled} onClick={toggleTerrain}><Mountain size={17} aria-hidden="true" /><span>Terrain elevation<small>{terrainStatus === "loading" ? "Loading measured heights…" : terrainStatus === "ready" ? "Measured heights · 1× scale" : terrainStatus === "unavailable" ? "Unavailable · select to retry" : "Off · show measured terrain"}</small></span><i aria-hidden="true" /></button>
            {terrainStatus === "unavailable" && <p className={styles.toolNotice} role="status">Elevation data could not load. Select Terrain elevation to retry.</p>}
            <div className={styles.toolActions}>
              <button type="button" onClick={() => mapRef.current?.easeTo({ bearing: 0, ...cameraMotion(520) })}><Compass size={15} aria-hidden="true" />Point map north</button>
              <button type="button" onClick={resetView}><Crosshair size={15} aria-hidden="true" />Reset map view</button>
              {routeCoordinates && <button type="button" onClick={fitPlannedRoute}><Expand size={15} aria-hidden="true" />Fit planned route</button>}
              {canFocus && <button type="button" onClick={focusMap}>{focused ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}{focused ? "Exit map focus" : "Focus map"}</button>}
            </div>
            {toolNotice && <p className={styles.toolNotice} role="status">{toolNotice}</p>}
          </div>}
        </div>
      </>}
      {!mapAvailable && <div className={styles.waitingOverlay} role="status"><SignalScanner compact title="Waiting for your GPS" description={mode === "planning" ? "Search for a place or choose a point to open the planning map." : "Your device position and travel direction appear with a fresh GPS fix."} /></div>}
      {mapAvailable && !ready && !mapError && <div className={styles.waitingOverlay} role="status"><SignalScanner compact title="Opening your map" description={usable ? "Loading the streets around your captured position." : "Loading a map for your journey."} /></div>}
      {mapAvailable && mapError && <div className={ready ? styles.errorBanner : styles.errorOverlay} role="status">
        {ready ? <p>{mapError}</p> : <SignalScanner compact state="error" title="Map unavailable" description={mapError} />}
        <button type="button" className={styles.retryButton} onClick={retryMap}><RefreshCw size={14} aria-hidden="true" />Retry map</button>
      </div>}
    </div>
    {showEvidence && <Disclosure title="Position & evidence" summary={usable ? `${points.length} captured ${points.length === 1 ? "position" : "positions"}` : "Awaiting GPS"} className={styles.evidence}>
      <dl className={styles.evidenceGrid}>
        <div className={styles.coordinates}><dt>{current ? "Reported coordinates" : "Last known coordinates"}</dt><dd>{rawUsable ? `${rawLatitude!.toFixed(6)}, ${rawLongitude!.toFixed(6)}` : "Unavailable"}</dd></div>
        <div><dt>Observed track</dt><dd>{points.length} positions</dd></div>
        <div><dt>GPS observation time</dt><dd>{observationTime(snapshot?.gps.recordedAt)}</dd></div>
        <div><dt>Received at capture</dt><dd>{observationTime(snapshot?.gps.receivedAt)}</dd></div>
        {terrainStatus !== "off" && <div><dt>Terrain elevation</dt><dd>{terrainStatus === "ready" ? "Mapzen measured heights · 1× scale" : terrainStatus === "loading" ? "Loading elevation tiles" : "Unavailable"}</dd></div>}
      </dl>
      <p className={styles.evidenceNote}>{hasBuildings ? "3D buildings use published map heights where available." : "Street detail is supplied by OpenFreeMap."}</p>
      {terrainStatus !== "off" && <p className={styles.evidenceNote}>Elevation tiles: Mapzen. <a href={TERRAIN_CREDITS} target="_blank" rel="noopener noreferrer">Terrain data sources and required credits</a>. Terrain height describes the ground surface.</p>}
    </Disclosure>}
  </section>;
}
