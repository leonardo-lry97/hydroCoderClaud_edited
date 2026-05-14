const path = require('path')
const fs = require('fs')
const { app } = require('electron')

let DefaultDatabase = null
function getDefaultDatabase() {
  if (!DefaultDatabase) {
    DefaultDatabase = require('better-sqlite3')
  }
  return DefaultDatabase
}

class HydrologyDatabase {
  constructor(options = {}) {
    this.db = null
    this.dbPath = null
    this._userDataPath = options.userDataPath || null
    this._Database = options.Database || null
  }

  init() {
    if (this.db) return

    const userDataPath = this._userDataPath || app.getPath('userData')
    this.dbPath = path.join(userDataPath, 'hydrology.db')

    const dir = path.dirname(this.dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const Database = this._Database || getDefaultDatabase()
    this.db = new Database(this.dbPath)
    this.db.pragma('busy_timeout = 5000')
    this.db.pragma('foreign_keys = ON')

    this.createTables()
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hydrology_stations (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        basin TEXT DEFAULT '',
        river TEXT DEFAULT '',
        longitude REAL,
        latitude REAL,
        elevation REAL,
        observation_types TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
        data_sources TEXT NOT NULL DEFAULT '{}',
        schedule TEXT NOT NULL DEFAULT '{}',
        validation_rules TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hydrology_observations (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        observation_type TEXT NOT NULL,
        source_type TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        slot_time TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        source_ref_id TEXT,
        governance_status TEXT NOT NULL DEFAULT 'normalized',
        review_status TEXT NOT NULL DEFAULT 'none',
        quality_flag TEXT NOT NULL DEFAULT 'normal',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hydrology_observation_slots (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        observation_type TEXT NOT NULL,
        slot_time TEXT NOT NULL,
        manual_value REAL,
        telemetry_value REAL,
        video_ocr_value REAL,
        chosen_value REAL,
        compare_status TEXT NOT NULL DEFAULT 'not_compared',
        missing_flags TEXT NOT NULL DEFAULT '[]',
        has_anomaly INTEGER NOT NULL DEFAULT 0,
        anomaly_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hydrology_manual_corrections (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        observation_type TEXT NOT NULL,
        target_time TEXT NOT NULL,
        slot_time TEXT NOT NULL,
        before_value REAL NOT NULL,
        after_value REAL NOT NULL,
        reason TEXT NOT NULL,
        approver TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hydrology_observation_anomalies (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        observation_type TEXT NOT NULL,
        slot_time TEXT NOT NULL,
        anomaly_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        evidence_ref TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  }

  createObservation(observation) {
    const now = Date.now()
    const id = observation.id || `obs-${now}-${Math.random().toString(36).slice(2, 8)}`
    this.db.prepare(`
      INSERT INTO hydrology_observations (
        id, station_id, observation_type, source_type, observed_at, slot_time,
        value, unit, source_ref_id, governance_status, review_status, quality_flag, metadata,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      observation.stationId,
      observation.observationType,
      observation.sourceType,
      observation.observedAt,
      observation.slotTime,
      observation.value,
      observation.unit || null,
      observation.sourceRefId || null,
      observation.governanceStatus,
      observation.reviewStatus,
      observation.qualityFlag,
      JSON.stringify(observation.metadata || {}),
      now,
      now
    )

    return this.getObservationById(id)
  }

  getObservationById(id) {
    return this.db.prepare(`
      SELECT * FROM hydrology_observations
      WHERE id = ?
    `).get(id)
  }

  listObservationsBySlot(stationId, observationType, slotTime) {
    return this.db.prepare(`
      SELECT * FROM hydrology_observations
      WHERE station_id = ? AND observation_type = ? AND slot_time = ?
      ORDER BY observed_at ASC
    `).all(stationId, observationType, slotTime)
  }

  upsertObservationSlot(slot) {
    const existing = this.getObservationSlotByKey(slot.stationId, slot.observationType, slot.slotTime)
    const now = Date.now()
    if (existing) {
      this.db.prepare(`
        UPDATE hydrology_observation_slots
        SET manual_value = ?, telemetry_value = ?, video_ocr_value = ?, chosen_value = ?,
            compare_status = ?, missing_flags = ?, has_anomaly = ?, anomaly_count = ?, updated_at = ?
        WHERE id = ?
      `).run(
        slot.manualValue,
        slot.telemetryValue,
        slot.videoOcrValue,
        slot.chosenValue,
        slot.compareStatus,
        JSON.stringify(slot.missingFlags || []),
        slot.hasAnomaly ? 1 : 0,
        slot.anomalyCount || 0,
        now,
        existing.id
      )
      return this.getObservationSlotById(existing.id)
    }

    const id = `slot-${now}-${Math.random().toString(36).slice(2, 8)}`
    this.db.prepare(`
      INSERT INTO hydrology_observation_slots (
        id, station_id, observation_type, slot_time,
        manual_value, telemetry_value, video_ocr_value, chosen_value,
        compare_status, missing_flags, has_anomaly, anomaly_count,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      slot.stationId,
      slot.observationType,
      slot.slotTime,
      slot.manualValue,
      slot.telemetryValue,
      slot.videoOcrValue,
      slot.chosenValue,
      slot.compareStatus,
      JSON.stringify(slot.missingFlags || []),
      slot.hasAnomaly ? 1 : 0,
      slot.anomalyCount || 0,
      now,
      now
    )
    return this.getObservationSlotById(id)
  }

  getObservationSlotByKey(stationId, observationType, slotTime) {
    return this.db.prepare(`
      SELECT * FROM hydrology_observation_slots
      WHERE station_id = ? AND observation_type = ? AND slot_time = ?
    `).get(stationId, observationType, slotTime)
  }

  getObservationSlotById(id) {
    return this.db.prepare(`
      SELECT * FROM hydrology_observation_slots
      WHERE id = ?
    `).get(id)
  }

  listObservationSlots(stationId, observationType = null) {
    if (observationType) {
      return this.db.prepare(`
        SELECT * FROM hydrology_observation_slots
        WHERE station_id = ? AND observation_type = ?
        ORDER BY slot_time DESC
      `).all(stationId, observationType)
    }

    return this.db.prepare(`
      SELECT * FROM hydrology_observation_slots
      WHERE station_id = ?
      ORDER BY slot_time DESC
    `).all(stationId)
  }

  createCorrection(correction) {
    const now = Date.now()
    const id = `corr-${now}-${Math.random().toString(36).slice(2, 8)}`
    this.db.prepare(`
      INSERT INTO hydrology_manual_corrections (
        id, station_id, observation_type, target_time, slot_time,
        before_value, after_value, reason, approver, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      correction.stationId,
      correction.observationType,
      correction.targetTime,
      correction.slotTime,
      correction.beforeValue,
      correction.afterValue,
      correction.reason,
      correction.approver,
      now,
      now
    )
    return this.getCorrectionById(id)
  }

  getCorrectionById(id) {
    return this.db.prepare(`
      SELECT * FROM hydrology_manual_corrections
      WHERE id = ?
    `).get(id)
  }

  listAnomaliesBySlot(stationId, observationType, slotTime) {
    return this.db.prepare(`
      SELECT * FROM hydrology_observation_anomalies
      WHERE station_id = ? AND observation_type = ? AND slot_time = ?
      ORDER BY created_at DESC
    `).all(stationId, observationType, slotTime)
  }

  listStations() {
    return this.db.prepare(`
      SELECT * FROM hydrology_stations
      ORDER BY basin ASC, code ASC
    `).all()
  }

  getStationById(id) {
    return this.db.prepare(`
      SELECT * FROM hydrology_stations
      WHERE id = ?
    `).get(id)
  }

  getStationByCode(code) {
    return this.db.prepare(`
      SELECT * FROM hydrology_stations
      WHERE code = ?
    `).get(code)
  }

  createStation(station) {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO hydrology_stations (
        id, code, name, basin, river, longitude, latitude, elevation,
        observation_types, status, timezone, data_sources, schedule, validation_rules,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      station.id,
      station.code,
      station.name,
      station.basin || '',
      station.river || '',
      station.longitude ?? null,
      station.latitude ?? null,
      station.elevation ?? null,
      JSON.stringify(station.observationTypes || []),
      station.status,
      station.timezone || 'Asia/Shanghai',
      JSON.stringify(station.dataSources || {}),
      JSON.stringify(station.schedule || {}),
      JSON.stringify(station.validationRules || {}),
      now,
      now
    )

    return this.getStationById(station.id)
  }

  updateStation(id, station) {
    this.db.prepare(`
      UPDATE hydrology_stations
      SET code = ?, name = ?, basin = ?, river = ?, longitude = ?, latitude = ?, elevation = ?,
          observation_types = ?, status = ?, timezone = ?, data_sources = ?, schedule = ?, validation_rules = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      station.code,
      station.name,
      station.basin || '',
      station.river || '',
      station.longitude ?? null,
      station.latitude ?? null,
      station.elevation ?? null,
      JSON.stringify(station.observationTypes || []),
      station.status,
      station.timezone || 'Asia/Shanghai',
      JSON.stringify(station.dataSources || {}),
      JSON.stringify(station.schedule || {}),
      JSON.stringify(station.validationRules || {}),
      Date.now(),
      id
    )

    return this.getStationById(id)
  }

  deleteStation(id) {
    const result = this.db.prepare(`
      DELETE FROM hydrology_stations
      WHERE id = ?
    `).run(id)

    return { success: result.changes > 0 }
  }

  close() {
    if (!this.db) return
    this.db.close()
    this.db = null
  }
}

module.exports = { HydrologyDatabase }
