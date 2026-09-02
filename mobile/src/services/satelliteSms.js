/**
 * Satellite/SMS incident bridge (issue #74).
 *
 * This is a second, separate fallback tier from syncQueue.js. syncQueue
 * handles ordinary spotty connectivity — enqueue in AsyncStorage, sync over
 * HTTP once a signal returns within minutes. This module handles the
 * scenario the issue is actually about: a field officer with *no* cellular
 * or Wi-Fi at all, only a weak satellite/SMS link that cannot carry an
 * image and may not resolve for hours.
 *
 * The split-payload strategy: the compressed NNER-CP metadata goes out now
 * over SMS so the hazard is on the dashboard within a text message's transit
 * time; the photo stays in this module's local SQLite table until the phone
 * reaches real bandwidth.
 */
import * as SQLite from 'expo-sqlite';
import * as SMS from 'expo-sms';

const DB_NAME = 'navner_satellite.db';
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';
const TWILIO_NUMBER = process.env.EXPO_PUBLIC_TWILIO_SMS_NUMBER || '+15005550006';

// NNER-CP codes — must match backend/app/services/sms_bridge.py exactly, or
// a report a field officer sent from a disaster zone silently fails to
// decode at the other end with no way to ask them to resend it correctly.
const TYPE_CODES = {
  LANDSLIDE: 'LND',
  FLOOD: 'FLD',
  BRIDGE_COLLAPSE: 'BRG',
  ROAD_DAMAGE: 'RB',
};
const SEVERITY_CODES = { CRITICAL: 'C', HIGH: 'H', MODERATE: 'M', LOW: 'L' };

const MAX_PAYLOAD_CHARS = 150;

let _db = null;
async function getDb() {
  if (!_db) {
    _db = await SQLite.openDatabaseAsync(DB_NAME);
    await _db.execAsync(`
      CREATE TABLE IF NOT EXISTS satellite_incidents (
        incident_id TEXT PRIMARY KEY NOT NULL,
        metadata_json TEXT NOT NULL,
        local_image_uri TEXT,
        sync_status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
  return _db;
}

function newIncidentId() {
  // Short and typeable, since it may end up read aloud over a radio, not
  // just displayed on a screen — unlike the sync queue's incident_id this one
  // has to survive being retyped by a human.
  return `INC${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

/**
 * Compress a report into the NNER-CP wire format.
 * Mirrors backend/app/services/sms_bridge.py:encode_sms_payload exactly.
 */
export function encodeSmsPayload({ incidentId, type, severity, lat, lng, description }) {
  const typeCode = TYPE_CODES[type];
  const severityCode = SEVERITY_CODES[severity];
  if (!typeCode) throw new Error(`Unknown incident type for SMS encoding: ${type}`);
  if (!severityCode) throw new Error(`Unknown severity for SMS encoding: ${severity}`);

  const fixed = `NNER|${incidentId}|${typeCode}|${severityCode}|${lat.toFixed(2)}|${lng.toFixed(2)}|`;
  const budget = Math.max(MAX_PAYLOAD_CHARS - fixed.length, 0);
  return fixed + (description || '').slice(0, budget);
}

/**
 * Save the full report (including the image URI) locally. Called before any
 * network action is attempted, so the report and its photo survive even if
 * the SMS send itself fails or the app is killed mid-flow.
 */
export async function saveIncidentLocally(report) {
  const db = await getDb();
  const incidentId = newIncidentId();
  const now = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO satellite_incidents (incident_id, metadata_json, local_image_uri, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?);`,
    incidentId,
    JSON.stringify(report),
    report.photoUri ?? null,
    'PENDING_SMS_DISPATCH',
    now,
  );

  return { incidentId, createdAt: now };
}

async function setStatus(incidentId, status) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE satellite_incidents SET sync_status = ? WHERE incident_id = ?;`,
    status,
    incidentId,
  );
}

/**
 * Dispatch the compressed report over the native SMS composer.
 *
 * expo-sms opens the OS composer rather than sending silently — there is no
 * way to send an SMS from a React Native app without the user seeing and
 * confirming it, which is also exactly what the demo script in the issue
 * wants (put the phone in airplane mode, fill the form, hit send, watch the
 * native composer open pre-filled).
 */
export async function dispatchSatelliteSms(report) {
  const isAvailable = await SMS.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('SMS is not available on this device (no SIM, or a simulator).');
  }

  const { incidentId, createdAt } = await saveIncidentLocally(report);
  const payload = encodeSmsPayload({ incidentId, ...report });

  const { result } = await SMS.sendSMSAsync([TWILIO_NUMBER], payload);

  // expo-sms reports whether the composer was sent/cancelled, not whether
  // Twilio received it — that confirmation would need the app to be online,
  // which is the one thing it is not in this flow. "sent" here means the
  // user tapped send in the native UI; the image stays queued regardless,
  // because the metadata's actual delivery is genuinely unknown either way.
  await setStatus(
    incidentId,
    result === 'sent' ? 'SMS_SENT_IMAGE_PENDING' : 'SMS_CANCELLED',
  );

  return { incidentId, createdAt, payload, smsResult: result };
}

/** Reports still waiting to push their image once real bandwidth returns. */
export async function getPendingImageUploads() {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM satellite_incidents WHERE sync_status = 'SMS_SENT_IMAGE_PENDING' AND local_image_uri IS NOT NULL;`,
  );
}

/**
 * Push a queued photo now that the device has a real connection.
 * Calls PATCH /api/v1/incidents/{readable_id}/image — the backend counterpart
 * of the "PENDING_NETWORK_SYNC" placeholder the webhook wrote.
 */
export async function syncPendingSatelliteImages() {
  const pending = await getPendingImageUploads();
  let synced = 0;

  for (const row of pending) {
    try {
      const form = new FormData();
      form.append('image', {
        uri: row.local_image_uri,
        name: 'incident.jpg',
        type: 'image/jpeg',
      });

      const res = await fetch(`${API_URL}/api/v1/incidents/${row.incident_id}/image`, {
        method: 'PATCH',
        body: form,
      });

      if (res.ok) {
        await setStatus(row.incident_id, 'FULLY_SYNCED');
        synced += 1;
      }
      // A non-ok response leaves the row PENDING for the next attempt —
      // network flakiness at the edge of coverage should not drop a photo
      // that a field officer risked a trip to a satellite zone to send.
    } catch {
      // Still offline, or the backend is briefly unreachable. Leave queued.
    }
  }

  return synced;
}

/** All locally-stored satellite reports, most recent first — for a "my
 * offline submissions" screen so a field officer can see what actually went
 * out while they had no way to confirm it in the moment. */
export async function getAllSatelliteIncidents() {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM satellite_incidents ORDER BY created_at DESC;`);
}
