/**
 * Network status badge — shows Online/Offline state.
 * Updated for Issue #36: yellow "Saved Locally — Waiting for Network" badge.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function NetworkBadge({ isOnline }) {
  return (
    <View style={[styles.badge, isOnline ? styles.online : styles.offline]}>
      <View style={[styles.dot, isOnline ? styles.dotOnline : styles.dotOffline]} />
      <Text style={[styles.text, isOnline ? styles.textOnline : styles.textOffline]}>
        {isOnline ? 'Online' : 'Saved Locally — Waiting for Network'}
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
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.2)',
  },
  offline: {
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.25)',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotOnline: {
    backgroundColor: '#22C55E',
  },
  dotOffline: {
    backgroundColor: '#FBBF24',
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
  textOnline: {
    color: '#22C55E',
  },
  textOffline: {
    color: '#FBBF24',
  },
});
