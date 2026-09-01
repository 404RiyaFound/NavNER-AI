/**
 * Reroute Audit Timeline — vertical timeline of recent dynamic reroute events.
 * Matches the desktop right-side column style.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function RerouteTimeline({ events }) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.sectionLabel}>Reroute Audit Timeline</Text>
      <View style={styles.card}>
        {events.map((event, idx) => {
          const isLast = idx === events.length - 1;
          return (
            <View key={event.id} style={styles.eventRow}>
              {/* Timeline column */}
              <View style={styles.timelineCol}>
                <View style={styles.dot} />
                {!isLast && <View style={styles.line} />}
              </View>
              {/* Content */}
              <View style={[styles.eventContent, !isLast && styles.eventContentBorder]}>
                <View style={styles.eventHeader}>
                  <Text style={styles.truckId}>{event.truckId}</Text>
                  <Text style={styles.timestamp}>{event.timestamp}</Text>
                </View>
                <Text style={styles.reason}>⚠️ {event.reason}</Text>
                <Text style={styles.newRoute}>→ {event.newRoute}</Text>
                <View style={styles.confidenceRow}>
                  <View style={styles.confidenceBadge}>
                    <Text style={styles.confidenceText}>
                      AI {event.aiConfidence}% confident
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 10,
    paddingHorizontal: 24,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: '#2C2C2E',
    borderRadius: 18,
    paddingVertical: 8,
    paddingLeft: 16,
    paddingRight: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  eventRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timelineCol: {
    alignItems: 'center',
    width: 16,
    paddingTop: 18,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF5B22',
    borderWidth: 2,
    borderColor: '#1C1C1C',
  },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: 'rgba(255,91,34,0.2)',
    marginTop: 4,
    minHeight: 20,
  },
  eventContent: {
    flex: 1,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 5,
  },
  eventContentBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  truckId: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FF5B22',
  },
  timestamp: {
    fontSize: 11,
    color: '#6B7280',
  },
  reason: {
    fontSize: 12,
    color: '#D1D5DB',
    lineHeight: 17,
  },
  newRoute: {
    fontSize: 12,
    color: '#22C55E',
    fontWeight: '600',
  },
  confidenceRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  confidenceBadge: {
    backgroundColor: 'rgba(255,91,34,0.12)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,91,34,0.2)',
  },
  confidenceText: {
    fontSize: 10,
    color: '#FF5B22',
    fontWeight: '600',
  },
});
