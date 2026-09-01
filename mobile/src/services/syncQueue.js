/**
 * Offline sync queue service.
 * Stores pending incident reports locally and syncs them when connectivity returns.
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
 */
export async function enqueue(report) {
  const queue = await getQueue();
  const entry = {
    ...report,
    _queuedAt: new Date().toISOString(),
    _id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

/**
 * Attempt to sync all queued reports to the backend.
 * Returns the number of successfully synced reports.
 */
export async function syncQueue() {
  const queue = await getQueue();
  if (queue.length === 0) return 0;

  let synced = 0;

  for (const report of queue) {
    try {
      const formData = new FormData();
      formData.append('type', report.type);
      formData.append('lat', String(report.lat));
      formData.append('lng', String(report.lng));
      if (report.description) formData.append('description', report.description);

      // If there's a photo, attach it
      if (report.photoUri) {
        const filename = report.photoUri.split('/').pop();
        formData.append('image', {
          uri: report.photoUri,
          name: filename || 'photo.jpg',
          type: 'image/jpeg',
        });
      }

      const response = await fetch(`${API_URL}/api/v1/incident`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.ok) {
        await dequeue(report._id);
        synced++;
      }
    } catch (err) {
      // Network still down — stop trying
      console.log('[SyncQueue] Sync failed for:', report._id, err.message);
      break;
    }
  }

  return synced;
}
