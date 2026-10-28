import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#2563eb"),
  createdAtUtc: text("created_at_utc").notNull(),
});

export const devices = sqliteTable("devices", {
  serial: text("serial").primaryKey(),
  name: text("name").notNull(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  model: text("model"),
  firmwareRaw: text("firmware_raw"),
  firstSeenUtc: text("first_seen_utc").notNull(),
  lastSeenUtc: text("last_seen_utc"),
  /** Highest archive index the server has fully covered (exclusive). */
  ackedNextIndex: integer("acked_next_index"),
  /** Lowest archive index ever stored for the device (full history reaches 0). */
  lowestStoredIndex: integer("lowest_stored_index"),
  fullHistoryComplete: integer("full_history_complete").notNull().default(0),
  clockWarning: integer("clock_warning").notNull().default(0),
  /** Series colour: palette key (theme-aware) or custom hex. */
  color: text("color").notNull().default("blue"),
  /** 1 when the user picked the colour; otherwise it follows the finish. */
  colorCustom: integer("color_custom").notNull().default(0),
  /** Image key under /public/devices (model + colour variant). */
  variant: text("variant").notNull().default("iluma-i-one-midnight-black"),
});

export const events = sqliteTable(
  "events",
  {
    serial: text("serial").notNull(),
    eventId: integer("event_id").notNull(),
    timestampUtc: text("timestamp_utc"),
    status: text("status").notNull(),
    responseHex: text("response_hex"),
    rawPacketsJson: text("raw_packets_json"),
    puffCount: integer("puff_count"),
    puffPairsJson: text("puff_pairs_json"),
    recordMarker: integer("record_marker"),
    clockSuspect: integer("clock_suspect").notNull().default(0),
    fetchedAtUtc: text("fetched_at_utc").notNull(),
    receivedAtUtc: text("received_at_utc").notNull(),
  },
  (t) => [primaryKey({ columns: [t.serial, t.eventId] }), index("events_time").on(t.serial, t.timestampUtc)],
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serial: text("serial").notNull(),
    collectedUtc: text("collected_utc").notNull(),
    valuesJson: text("values_json").notNull(),
    statusesJson: text("statuses_json").notNull(),
    framesJson: text("frames_json").notNull(),
  },
  (t) => [index("snapshots_latest").on(t.serial, t.id)],
);

export const liveState = sqliteTable("live_state", {
  serial: text("serial").primaryKey(),
  agentId: integer("agent_id"),
  updatedUtc: text("updated_utc").notNull(),
  battery: integer("battery"),
  stickState: text("stick_state"),
  errorState: integer("error_state"),
  lifetimeSticks: integer("lifetime_sticks"),
  lifetimePuffs: integer("lifetime_puffs"),
  lifetimeSeconds: integer("lifetime_seconds"),
  sessionRaw: text("session_raw"),
  /** Set by the agent when it closes the device or loses it. */
  disconnectedUtc: text("disconnected_utc"),
  syncStatus: text("sync_status"),
  extraJson: text("extra_json"),
});

export const liveSamples = sqliteTable(
  "live_samples",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serial: text("serial").notNull(),
    atUtc: text("at_utc").notNull(),
    battery: integer("battery"),
    stickState: text("stick_state"),
    lifetimeSticks: integer("lifetime_sticks"),
    lifetimePuffs: integer("lifetime_puffs"),
    extraJson: text("extra_json"),
  },
  (t) => [index("live_samples_time").on(t.serial, t.atUtc)],
);

export const observations = sqliteTable(
  "observations",
  {
    serial: text("serial").notNull(),
    eventId: integer("event_id").notNull(),
    endNoticeUtc: text("end_notice_utc"),
    puffsEstimate: integer("puffs_estimate"),
    source: text("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.serial, t.eventId] })],
);

export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  apiKeyHash: text("api_key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  createdAtUtc: text("created_at_utc").notNull(),
  lastSeenUtc: text("last_seen_utc"),
  version: text("version"),
  hostname: text("hostname"),
});

export const agentJobs = sqliteTable(
  "agent_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serial: text("serial").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json"),
    status: text("status").notNull().default("queued"),
    progressDone: integer("progress_done").notNull().default(0),
    progressTotal: integer("progress_total"),
    message: text("message"),
    createdUtc: text("created_utc").notNull(),
    updatedUtc: text("updated_utc").notNull(),
  },
  (t) => [index("agent_jobs_serial").on(t.serial, t.status)],
);

export type User = typeof users.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
export type LiveState = typeof liveState.$inferSelect;
export type LiveSample = typeof liveSamples.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type AgentJob = typeof agentJobs.$inferSelect;
