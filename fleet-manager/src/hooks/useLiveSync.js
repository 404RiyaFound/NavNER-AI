/**
 * Live transit sync over the backend's broadcast WebSocket.
 *
 * The transit list must not look authoritative while disconnected — a stale
 * list rendered as live is the same failure as showing zeroes for an unreachable
 * backend. `connected` is returned so the UI can say which it is.
 *
 * Events handled (all broadcast server -> client):
 *   telemetry_update — a vehicle moved; patch its coordinates in place
 *   reroute_alert    — a trip was rerouted; patch status and prepend a
 *                      transition, so the audit trail grows without a refetch
 *   risk_update      — hazard scores changed; the summary is stale, refetch
 *   new_incident     — a new hazard was reported; refetch
 */
import { useEffect, useRef, useState } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL
  || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

const RECONNECT_MS = 3000;
// Hazard events arrive in bursts during an evaluation sweep; refetching per
// event would hammer the API for one logical change.
const REFETCH_DEBOUNCE_MS = 1200;

export function useLiveSync({ onTelemetry, onReroute, onInvalidate }) {
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState(null);
  const [eventCount, setEventCount] = useState(0);

  // Handlers live in refs so a new callback identity does not tear down and
  // reopen the socket on every render.
  const handlers = useRef({ onTelemetry, onReroute, onInvalidate });
  useEffect(() => {
    handlers.current = { onTelemetry, onReroute, onInvalidate };
  }, [onTelemetry, onReroute, onInvalidate]);

  useEffect(() => {
    let ws;
    let reconnectTimer;
    let debounceTimer;
    let closed = false;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(WS_URL);

      ws.onopen = () => setConnected(true);

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return; // non-JSON frame — nothing to apply
        }

        setLastEventAt(new Date());
        setEventCount((n) => n + 1);

        switch (msg.event) {
          case 'telemetry_update':
            handlers.current.onTelemetry?.(msg.data);
            break;
          case 'reroute_alert':
            handlers.current.onReroute?.(msg.data);
            break;
          case 'risk_update':
          case 'new_incident':
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(
              () => handlers.current.onInvalidate?.(msg.event),
              REFETCH_DEBOUNCE_MS,
            );
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!closed) reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(debounceTimer);
      if (ws) {
        ws.onclose = null; // do not schedule a reconnect while unmounting
        ws.close();
      }
    };
  }, []);

  return { connected, lastEventAt, eventCount };
}
