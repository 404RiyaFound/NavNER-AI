/**
 * Network status badge — shows Online/Offline state.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function NetworkBadge({ isOnline }) {
  return (
    <View style={[styles.badge, isOnline ? styles.online : styles.offline]}>
      <View style={[styles.dot, isOnline ? styles.dotOnline : styles.dotOffline]} />
      <Text style={[styles.text, isOnline ? styles.textOnline : styles.textOffline]}>
        {isOnline ? 'Online' : 'Offline — Saving Locally'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 6,
  },
  online: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
  },
  offline: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotOnline: {
    backgroundColor: '#22c55e',
  },
  dotOffline: {
    backgroundColor: '#ef4444',
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
  textOnline: {
    color: '#22c55e',
  },
  textOffline: {
    color: '#ef4444',
  },
});
