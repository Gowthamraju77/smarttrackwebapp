"use client";

import { useId, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Cpu,
  Info,
  LifeBuoy,
  Phone,
  RotateCcw,
  Search,
} from "lucide-react";
import styles from "./help-view.module.css";

type Topic = "all" | "getting-started" | "hardware" | "troubleshooting" | "limitations";

type HelpArticle = {
  id: string;
  topic: Exclude<Topic, "all">;
  title: string;
  summary: string;
  keywords: string;
  paragraphs: readonly string[];
  steps?: readonly string[];
  note?: string;
  pinReference?: boolean;
};

const topics: readonly { id: Topic; label: string }[] = [
  { id: "all", label: "All topics" },
  { id: "getting-started", label: "Getting started" },
  { id: "hardware", label: "Hardware" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "limitations", label: "ML & emergency" },
];

// Reference values from docs/CONTRACT.md; these are not detected device settings.
const pinReference = [
  { part: "GPS UART", pins: "RX GPIO6 · TX GPIO7", note: "ESP32-side directions: module TX connects to RX6; module RX to TX7. Verify module voltage levels." },
  { part: "I²C", pins: "SDA GPIO17 · SCL GPIO18", note: "Check sensor voltage, pull-ups, and the exact module address." },
  { part: "TFT SPI", pins: "SCK GPIO12 · MOSI GPIO11 · MISO GPIO13", note: "SPI bus shared with touch; each peripheral needs its own verified chip select." },
  { part: "TFT control", pins: "CS GPIO10 · DC GPIO9 · RST GPIO8", note: "Match the display controller and connector to its datasheet." },
  { part: "Touch", pins: "CS GPIO14 · IRQ GPIO15", note: "Verify the touch controller and calibration separately from the display." },
  { part: "Backlight", pins: "GPIO5", note: "Control through a transistor; this is not a direct LED power connection." },
  { part: "Buttons", pins: "Power GPIO4 · SOS GPIO1 · User GPIO2", note: "Verify the actual button circuit before testing input behavior." },
  { part: "Peripheral power", pins: "GPIO21", note: "Active-low P-FET control. The TPS22918 is not pin/control-equivalent." },
  { part: "Modem UART", pins: "RX GPIO48 · TX GPIO47", note: "RESERVED; modem off by default. Check the GPIO48 board LED conflict and bare-modem UART voltage." },
  { part: "microSD chip select", pins: "Unassigned (−1)", note: "Disabled at compile time until the actual wiring is specified. Do not guess a CS pin." },
  { part: "Modem PWRKEY", pins: "Unassigned (−1)", note: "Disabled at compile time. Exact modem voltage and PWRKEY timing require board validation." },
] as const;

const articles: readonly HelpArticle[] = [
  {
    id: "demo-and-production",
    topic: "getting-started",
    title: "What does demo mode show?",
    summary: "Understand synthetic previews, local controls, and production data.",
    keywords: "demo synthetic live production authentication sign in workspace dashboard local persistence",
    paragraphs: [
      "Demo screens use explicitly labelled synthetic examples. A preview, local toggle, or checklist does not register a device, write to the production service, or prove that hardware is connected.",
      "Production reads and writes require authentication and tenant-scoped access. When a protected service is not configured, it must fail closed with 503 rather than substitute demo data. Ask your workspace administrator to configure the service and your access.",
    ],
  },
  {
    id: "device-onboarding",
    topic: "getting-started",
    title: "How do I bring a device online?",
    summary: "A staged setup plan, from the exact board to a confirmed server receipt.",
    keywords: "onboarding setup provision register connect first device esp32 esp32-s3 firmware wifi Wi-Fi network HTTPS TLS",
    paragraphs: [
      "Start with the exact ESP32-S3 board and module revisions, their datasheets, and the firmware configuration. This guide is a reference; it has not verified your equipment.",
    ],
    steps: [
      "With power disconnected, compare the wiring to the pin reference. Confirm module voltage levels, the peripheral power circuit, and the regulator's thermal/current capability for the actual load.",
      "Keep the reserved modem disabled. Leave unspecified microSD CS and modem PWRKEY at −1 until their wiring and control requirements are known.",
      "Use your team's authenticated provisioning process to register the device and configure its device secret, network, HTTPS endpoint, and certificate validation. Keep credentials out of shared logs.",
      "Plan a controlled bench test. Inspect actual GPS-fix and sensor availability rather than treating missing readings as zero or current position.",
      "Verify a matching accepted server receipt for a telemetry record, then test offline replay without changing its identity. Coordinate any SOS test with the people responsible for receiving it.",
    ],
    note: "Checking the reading checklist here records only your review in this page's memory. Hardware, delivery, and service configuration still need their own tests.",
  },
  {
    id: "server-receipt",
    topic: "getting-started",
    title: "How can I confirm an upload was accepted?",
    summary: "An HTTP response alone is not permission to remove a queued record.",
    keywords: "ack receipt accepted record_id duplicate queue removal response retry CRC32 ingest sos",
    paragraphs: [
      "For POST /api/ingest and POST /api/sos, remove a queued record only when the JSON response has accepted: true, the exact matching record_id, and a boolean duplicate field. A timeout, a generic 2xx response, or a mismatched ID does not supply that receipt.",
      "Keep device_id and record_id stable across retries, including SOS retries. The server uses that pair to recognize duplicates. CRC32 IEEE checks the UTF-8 bytes of the exact payload string, not a newly serialized copy.",
      "An SOS ingestion receipt confirms server acceptance only. Responder acknowledgement and resolution are separate, audited transitions; none of these is proof that emergency services have been dispatched.",
    ],
  },
  {
    id: "pin-reference",
    topic: "hardware",
    title: "ESP32-S3 pin reference",
    summary: "The contracted GPIO map, reserved UART, and deliberately unassigned pins.",
    keywords: "pin reference wiring GPIO RX6 TX7 I2C SPI TFT touch microSD SD CS PWRKEY -1 power SOS user",
    paragraphs: [
      "These are ESP32-S3 GPIO numbers, not connector positions. UART RX/TX are named from the ESP32 side. Confirm the exact board and all attached modules before applying power.",
    ],
    pinReference: true,
    note: "Reference only; no equipment test is implied. GPIO48 board-LED use, modem UART voltage, PWRKEY timing, and regulator thermal capability require exact-board validation.",
  },
  {
    id: "power-and-modem",
    topic: "hardware",
    title: "Why are the modem and some pins disabled?",
    summary: "Power-control differences and unknown wiring must be resolved first.",
    keywords: "modem disabled power GPIO21 GPIO48 GPIO47 TPS22918 P-FET active low transistor GPIO5 LED regulator voltage thermal PWRKEY microSD -1",
    paragraphs: [
      "The modem is off by default; RX GPIO48 and TX GPIO47 are reserved. A bare modem's UART may use a different voltage than the ESP32-S3, and GPIO48 may already drive the board LED. Verify the exact hardware before enabling this interface.",
      "GPIO21 controls an active-low P-FET peripheral rail. The PDF's TPS22918 is not pin/control-equivalent to that circuit; do not substitute it as a drop-in part or assume the same enable polarity. GPIO5 backlight control goes through a transistor.",
      "The unspecified microSD CS and modem PWRKEY remain −1 (compile-time disabled). Pin selection, PWRKEY timing, and the regulator's thermal/current capability need actual schematics, datasheets, and bench measurements, not guessed defaults.",
    ],
  },
  {
    id: "gps-fix",
    topic: "troubleshooting",
    title: "There is no GPS fix, or the position is old",
    summary: "Separate a current fix from stale coordinates and missing data.",
    keywords: "GPS fix location position stale old missing antenna UART RX6 TX7 HDOP age lat lon null satellite",
    paragraphs: [
      "A previous coordinate is not a current fix. Check fix state, age, and HDOP when available. Missing or invalid coordinates must remain unavailable; do not replace them with 0,0 or label a cached position live.",
    ],
    steps: [
      "Inspect the antenna connection and view of the sky where it is safe to do so. Acquisition time depends on the actual receiver and conditions.",
      "Check the GPS power and voltage levels, common ground, and UART direction: ESP32 RX GPIO6 receives module TX; ESP32 TX GPIO7 connects to module RX. Verify the module's serial configuration.",
      "Compare device recorded_at with server received_at. An unsynchronized offline device can legitimately have null recorded_at; received_at is not the time the location was measured.",
    ],
    note: "SOS must not wait for a GPS fix or an ML score. Missing location can still make human response harder; use another available emergency contact method.",
  },
  {
    id: "offline-queue",
    topic: "troubleshooting",
    title: "Records remain in the offline queue",
    summary: "Check storage, network, and exact receipts without losing retry identity.",
    keywords: "offline queue retry reconnect network upload Wi-Fi wifi SD microSD storage backlog CRC32 TLS certificate HTTPS receipt",
    paragraphs: [
      "Offline retention depends on configured, working storage. microSD CS is disabled at −1 until the real wiring is specified; this reference cannot promise queue durability on unvalidated equipment.",
    ],
    steps: [
      "Inspect actual storage health and the firmware's queue errors. Preserve queued records while investigating; do not clear a backlog just to hide an error.",
      "Check network reachability, endpoint configuration, and HTTPS certificate validation. Resolve a TLS failure rather than disabling certificate checks.",
      "Compare the exact payload string's UTF-8 CRC32 IEEE with the envelope's eight hexadecimal crc32 characters. Do not reserialize the payload before calculating its checksum.",
      "Retain the original device_id and record_id on replay. Remove an item only after accepted: true, its matching record_id, and a boolean duplicate arrive in the server receipt.",
    ],
    note: "Queued means pending, not delivered. Connectivity returning does not itself confirm server acceptance or SOS response.",
  },
  {
    id: "service-errors",
    topic: "troubleshooting",
    title: "The API rejects a request or is unavailable",
    summary: "Use the response to distinguish validation, access, and configuration issues.",
    keywords: "error API 400 401 403 429 503 unavailable auth authentication permission role tenant rate limit authorization secret CRC32",
    paragraphs: [
      "Read the actual response and appropriate server logs. For validation errors, check the v1 envelope, exact payload checksum, required identifiers, finite numbers, and GPS bounds. For 401/403 responses, verify credentials, tenant membership, and the operation's required role with an administrator.",
      "A protected API returns 503 when required production configuration is absent. It must not silently use demo data. If rate-limited, respect the service's retry guidance while preserving record identity.",
      "Device ingestion uses Authorization: Bearer with a device secret; the server stores its SHA256 hash. Do not put a secret into browser-side help, screenshots, or shared diagnostics. User access and device authentication are separate concerns.",
    ],
  },
  {
    id: "display-touch",
    topic: "troubleshooting",
    title: "The screen is blank or touch does not respond",
    summary: "Check display power and control signals independently of telemetry.",
    keywords: "display screen blank backlight TFT touch SPI SCK MOSI MISO GPIO12 GPIO11 GPIO13 CS10 DC9 RST8 CS14 IRQ15 GPIO5",
    paragraphs: [
      "With power disconnected, compare the display wiring to the pin reference: SPI SCK12 / MOSI11 / MISO13, TFT CS10 / DC9 / RST8, and touch CS14 / IRQ15. Backlight GPIO5 controls a transistor; check its circuit instead of treating the GPIO as the LED supply.",
      "Verify the exact display/touch controllers and firmware configuration. A lit backlight does not prove SPI communication, a rendered page does not prove touch calibration, and either can work while telemetry is offline.",
      "A route trace is not a road map. Offline roads require supplied, licensed map data; a line connecting locations cannot stand in for a routable street network.",
    ],
  },
  {
    id: "ml-limits",
    topic: "limitations",
    title: "What can the ML reliability index tell me?",
    summary: "A reliability index is not a safety probability or a guarantee.",
    keywords: "ML unavailable machine learning AI score trust reliability index model synthetic calibration evaluation promoted anomaly safety confidence",
    paragraphs: [
      "ML scores are reliability indices, not safety probabilities. They cannot establish that a person or journey is safe, predict every incident, or replace human judgement. Missing, delayed, or unusual sensor data can limit what a model can support.",
      "ML is unavailable by default. Production scoring requires a separately deployed service and an explicitly evaluated and promoted model artifact. Synthetic demonstration models cannot produce production scores; an unavailable model must not be replaced with an invented score.",
      "Use available evidence, timestamps, and data-quality indicators alongside any evaluated score. SOS does not require ML, an IMU reading, or a GPS fix and must not be gated by a model result.",
    ],
  },
  {
    id: "sos-limits",
    topic: "limitations",
    title: "What happens after an SOS?",
    summary: "Know the difference between queued, accepted, acknowledged, and resolved.",
    keywords: "SOS emergency help dispatch ambulance police call rescue queued accepted acknowledged resolved delivery GPS ML offline button GPIO1",
    paragraphs: [
      "In immediate danger, contact your local emergency services using an available method. SmartTrack is not an emergency-dispatch service, and this help page neither sends an SOS nor contacts a responder.",
      "SOS can be created without a GPS fix, IMU, or ML. Delivery still depends on working device power, storage, connectivity, backend configuration, and a response process. Offline SOS may remain queued; do not assume it was received.",
    ],
    steps: [
      "Queued: the device has pending work; no server acceptance is confirmed.",
      "Accepted: a matching ingestion receipt exists; it does not prove a human saw the event or a notification was delivered.",
      "Acknowledged: a separate responder action is recorded with audit evidence. It is not resolution or proof of emergency-service dispatch.",
      "Resolved: a separate audited workflow transition. Its label alone is not independent proof that someone is safe.",
    ],
    note: "Keep an SOS record's identity stable across retries. Verify the end-to-end response process in an agreed test; this reference makes no equipment, delivery-time, or response guarantee.",
  },
];

const onboarding = [
  { id: "board", title: "Identify the exact hardware", detail: "Board and module revisions, datasheets, and connector labels." },
  { id: "pins", title: "Review the GPIO reference", detail: "Shared SPI, reserved modem UART, and unassigned −1 pins." },
  { id: "power", title: "Review power and voltage", detail: "Active-low P-FET, transistor backlight, UART levels, and regulator limits." },
  { id: "provision", title: "Plan authenticated provisioning", detail: "Device registration, secret handling, and HTTPS certificate validation." },
  { id: "verify", title: "Plan a controlled end-to-end test", detail: "Actual readings, exact receipts, offline replay, and coordinated SOS handling." },
] as const;

function normalizeSearch(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const searchableArticles = articles.map((article) => ({
  article,
  text: normalizeSearch([
    article.title,
    article.summary,
    article.keywords,
    ...article.paragraphs,
    ...(article.steps ?? []),
    article.note ?? "",
    article.pinReference ? pinReference.map((pin) => `${pin.part} ${pin.pins} ${pin.note}`).join(" ") : "",
  ].join(" ")),
}));

export default function HelpView() {
  const id = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<Topic>("all");
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  const filteredArticles = searchableArticles.filter(({ article, text }) =>
    (topic === "all" || article.topic === topic) && terms.every((term) => text.includes(term)),
  );

  function resetSearch() {
    setQuery("");
    setTopic("all");
    searchInput.current?.focus();
  }

  function selectQuickSearch(value: string) {
    setQuery(value);
    setTopic("all");
    setExpandedArticle(null);
    searchInput.current?.focus();
  }

  return (
    <div className={styles.helpView}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Workspace resources</p>
          <h1>Help &amp; setup</h1>
          <p className={styles.subtitle}>A little guidance for the next step. Explore the basics, review your hardware, or find an answer.</p>
        </div>
        <span className={styles.referenceBadge}><BookOpen size={15} aria-hidden="true" /> Reference guide</span>
      </header>

      <section className={styles.searchPanel} aria-labelledby={`${id}-search-heading`}>
        <span className={styles.heroIcon}><LifeBuoy size={24} aria-hidden="true" /></span>
        <div className={styles.searchContent}>
          <h2 id={`${id}-search-heading`}>What do you need a hand with?</h2>
          <p>Search setup steps, troubleshooting, and the limits of SmartTrack.</p>
          <div role="search" aria-label="Help articles">
            <label className={styles.srOnly} htmlFor={`${id}-search`}>Search help</label>
            <div className={styles.searchField}>
              <Search size={18} aria-hidden="true" />
              <input
                id={`${id}-search`}
                ref={searchInput}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Try “no GPS fix” or “GPIO21”"
                aria-describedby={`${id}-search-hint`}
                aria-controls={`${id}-articles`}
                autoComplete="off"
              />
            </div>
          </div>
          <div className={styles.quickSearches}>
            <span id={`${id}-search-hint`}>Popular:</span>
            {["GPS fix", "Pin reference", "Offline queue", "ML unavailable"].map((value) => (
              <button type="button" key={value} onClick={() => selectQuickSearch(value)}>{value}</button>
            ))}
          </div>
        </div>
      </section>

      <aside className={styles.emergencyNotice} aria-labelledby={`${id}-emergency-heading`}>
        <Phone size={18} aria-hidden="true" />
        <div>
          <h2 id={`${id}-emergency-heading`}>Need emergency assistance?</h2>
          <p>Contact your local emergency services using an available method. SmartTrack does not dispatch emergency services. A queued SOS is not confirmation of delivery or response.</p>
        </div>
      </aside>

      <div className={styles.contentGrid}>
        <section className={styles.library} aria-labelledby={`${id}-library-heading`}>
          <div className={styles.sectionHeading}>
            <div><p className={styles.eyebrow}>Knowledge base</p><h2 id={`${id}-library-heading`}>Find your next step</h2></div>
            <CircleHelp size={20} aria-hidden="true" />
          </div>
          <div className={styles.topicFilters} role="group" aria-label="Filter help by topic">
            {topics.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={topic === item.id}
                className={topic === item.id ? styles.activeTopic : undefined}
                onClick={() => setTopic(item.id)}
              >{item.label}</button>
            ))}
          </div>
          <p className={styles.resultCount} role="status" aria-live="polite" aria-atomic="true">
            {filteredArticles.length} {filteredArticles.length === 1 ? "article" : "articles"}
            {query.trim() ? ` matching “${query.trim()}”` : " to explore"}
            {topic !== "all" ? ` in ${topics.find((item) => item.id === topic)?.label}` : ""}
          </p>

          <div id={`${id}-articles`} className={styles.articleList}>
            {filteredArticles.map(({ article }) => {
              const expanded = expandedArticle === article.id;
              return (
                <article key={article.id} className={styles.article}>
                  <p className={styles.articleTopic}>{topics.find((item) => item.id === article.topic)?.label}</p>
                  <h3>
                    <button
                      type="button"
                      className={styles.articleToggle}
                      id={`${id}-${article.id}-toggle`}
                      aria-expanded={expanded}
                      aria-controls={`${id}-${article.id}-body`}
                      onClick={() => setExpandedArticle(expanded ? null : article.id)}
                    >
                      <span>{article.title}</span>
                      <ChevronDown size={18} className={expanded ? styles.chevronOpen : undefined} aria-hidden="true" />
                    </button>
                  </h3>
                  <p className={styles.articleSummary}>{article.summary}</p>
                  <div id={`${id}-${article.id}-body`} className={styles.articleBody} hidden={!expanded}>
                    {article.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                    {article.steps && <ol>{article.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
                    {article.pinReference && (
                      <div className={styles.pinTableWrapper} role="region" aria-label="Scrollable ESP32-S3 GPIO reference" tabIndex={0}>
                        <table className={styles.pinTable}>
                          <caption>Contract pin assignments · verify against your exact board</caption>
                          <thead><tr><th scope="col">Connection</th><th scope="col">GPIO assignment</th><th scope="col">Before use</th></tr></thead>
                          <tbody>{pinReference.map((pin) => <tr key={pin.part}><th scope="row">{pin.part}</th><td>{pin.pins}</td><td>{pin.note}</td></tr>)}</tbody>
                        </table>
                      </div>
                    )}
                    {article.note && <div className={styles.articleNote}><Info size={16} aria-hidden="true" /><p>{article.note}</p></div>}
                  </div>
                </article>
              );
            })}
            {filteredArticles.length === 0 && (
              <div className={styles.emptyState}>
                <Search size={26} aria-hidden="true" />
                <h3>No help articles found</h3>
                <p>Try fewer words, a GPIO number, or a different topic. Search matches all the words you enter.</p>
                <button type="button" className={styles.outlineButton} onClick={resetSearch}>Clear search and show all topics</button>
              </div>
            )}
          </div>
        </section>

        <aside className={styles.sidebar} aria-label="Setup checklist and essential guidance">
          <section className={styles.checklistCard} aria-labelledby={`${id}-checklist-heading`}>
            <span className={styles.cardIcon}><ClipboardList size={20} aria-hidden="true" /></span>
            <p className={styles.eyebrow}>Start with the basics</p>
            <h2 id={`${id}-checklist-heading`}>Hardware onboarding</h2>
            <p className={styles.cardDescription}>A reading checklist for your setup plan. Checks mark your review, not a verified device.</p>
            <div className={styles.progressLabel}><span>Local to this page</span><strong role="status" aria-live="polite">{reviewed.length}/{onboarding.length} reviewed</strong></div>
            <progress className={styles.progress} value={reviewed.length} max={onboarding.length} aria-label="Onboarding items reviewed" />
            <fieldset className={styles.checklist}>
              <legend className={styles.srOnly}>Mark setup guidance as reviewed</legend>
              {onboarding.map((item) => (
                <label className={styles.checklistItem} key={item.id}>
                  <input
                    type="checkbox"
                    checked={reviewed.includes(item.id)}
                    onChange={(event) => setReviewed((previous) => event.target.checked
                      ? [...previous, item.id]
                      : previous.filter((entry) => entry !== item.id))}
                  />
                  <span><strong>{item.title}</strong><span>{item.detail}</span></span>
                </label>
              ))}
            </fieldset>
            <p className={styles.localNote}>Stored only in page memory; reloading resets it. Nothing is sent to a device or server.</p>
            <button type="button" className={styles.resetButton} disabled={reviewed.length === 0} onClick={() => setReviewed([])}><RotateCcw size={14} aria-hidden="true" /> Reset checklist</button>
          </section>

          <section className={styles.limitsCard} aria-labelledby={`${id}-limits-heading`}>
            <Cpu size={20} aria-hidden="true" />
            <h2 id={`${id}-limits-heading`}>A score is not a safety guarantee</h2>
            <p>ML reports reliability indices, not safety probabilities. It remains unavailable without an evaluated, explicitly promoted model. Synthetic models cannot supply production scores.</p>
            <button type="button" className={styles.textButton} onClick={() => {
              setQuery("");
              setTopic("limitations");
              setExpandedArticle("ml-limits");
            }}>Read ML &amp; emergency guidance <BookOpen size={14} aria-hidden="true" /></button>
          </section>

          <section className={styles.supportCard} aria-labelledby={`${id}-support-heading`}>
            <div className={styles.supportHeading}><Cpu size={18} aria-hidden="true" /><h2 id={`${id}-support-heading`}>Still investigating?</h2></div>
            <p>Give your workspace administrator the board and module revisions, firmware version, exact error, and steps to reproduce. Remove credentials and personal location data from shared diagnostics.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
