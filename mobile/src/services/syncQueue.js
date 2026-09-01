/**
 * Offline sync queue service.
 * Stores pending incident reports locally and syncs them when connectivity returns.
 * Updated for Issue #36: adds severity, estimatedClearanceHrs, incidentId fields,
 * and Firebase mock functions (uploadImageToFirebaseStorage, saveToFirestore).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = '@navner_sync_queue';
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Get all pending reports from the local queue.
 */
export async function getQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Add a report to the local sync queue.
 * Report schema (Issue #36):
 *   type, severity, description, estimatedClearanceHrs, lat, lng, photoUri
 */
export async function enqueue(report) {
  const queue = await getQueue();
  const entry = {
    ...report,
    incident_id: `INC-${Date.now().toString(36).toUpperCase()}-NL`,
    _queuedAt: new Date().toISOString(),
    _id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sync_status: 'PENDING_FIREBASE_UPLOAD',
    ai_predicted_clearance_hrs: null,
  };
  queue.push(entry);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return entry;
}

/**
 * Remove a successfully synced report from the queue.
 */
async function dequeue(id) {
  const queue = await getQueue();
  const filtered = queue.filter(item => item._id !== id);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
}

// ---------------------------------------------------------------------------
// Firebase Mock Functions (Issue #36 — Section 3.1)
// Replace with real Firebase SDK calls when credentials are available.
// ---------------------------------------------------------------------------

/**
 * Mock: Upload an image to Firebase Cloud Storage.
 * @param {string} uri - Local URI of the image.
 * @returns {Promise<string>} - Firebase Storage URL.
 */
export async function uploadImageToFirebaseStorage(uri) {
  // TODO: Replace with real Firebase Storage upload
  await new Promise(resolve => setTimeout(resolve, 800));
  const filename = uri.split('/').pop() || 'incident.jpg';
  return `gs://ner-logistics.appspot.com/incidents/${filename}`;
}

/**
 * Mock: Save a structured incident payload to Firestore.
 * @param {object} data - The incident report payload.
 * @returns {Promise<string>} - Firestore document ID.
 */
export async function saveToFirestore(data) {
  // TODO: Replace with real Firestore write
  await new Promise(resolve => setTimeout(resolve, 600));
  const docId = `doc-${Date.now().toString(36)}`;
  console.log('[Firestore Mock] Saved document:', docId, data);
  return docId;
}

// ---------------------------------------------------------------------------
// Two-Tier Sync Logic (Issue #36 — Section 3.1)
// ---------------------------------------------------------------------------

/**
 * Attempt to sync all queued reports to the backend via Firebase.
 * Returns the number of successfully synced reports.
 */
export async function syncQueue() {
  const queue = await getQueue();
  if (queue.length === 0) return 0;

  let synced = 0;

  for (const report of queue) {
    try {
      // Step 1: Upload image to Firebase Storage (if present)
      let imageUrl = null;
      if (report.photoUri) {
        imageUrl = await uploadImageToFirebaseStorage(report.photoUri);
      }

      // Step 2: Save structured payload to Firestore
      const payload = {
        incident_id: report.incident_id,
        reported_by: 'FIELD_OFFICIAL',
        timestamp: report._queuedAt,
        geo_tag: { lat: report.lat, lng: report.lng },
        incident_type: report.type?.toUpperCase(),
        severity_level: report.severity?.toUpperCase(),
        description: report.description,
        user_estimated_clearance_hrs: report.estimatedClearanceHrs,
        ai_predicted_clearance_hrs: null,
        verification_image_url: imageUrl,
        sync_status: 'SYNCED',
      };

      await saveToFirestore(payload);
      await dequeue(report._id);
      synced++;
    } catch (err) {
      // Network still down — stop trying
      console.log('[SyncQueue] Sync failed for:', report._id, err.message);
      break;
    }
  }

  return synced;
}
