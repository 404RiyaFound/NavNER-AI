/**
 * Custom map marker for a fleet truck.
 * Shows cargo icon, truck ID, and delay risk indicator.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export function TruckMarker({ truck, onPress, isSelected }) {
  const riskColor =
    truck.delayRisk >= 75 ? '#EF4444' :
    truck.delayRisk >= 40 ? '#FF5B22' : '#22C55E';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.wrapper, isSelected && styles.wrapperSelected]}>
        <View style={[styles.bubble, isSelected && styles.bubbleSelected]}>
          <Text style={styles.icon}>{truck.cargoIcon}</Text>
          <Text style={styles.id}>{truck.id}</Text>
        </View>
        {/* Risk dot */}
        <View style={[styles.riskDot, { backgroundColor: riskColor }]} />
        {/* Pointer */}
        <View style={[styles.pointer, isSelected && styles.pointerSelected]} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  wrapperSelected: {
    transform: [{ scale: 1.12 }],
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#2C2C2E',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 8,
  },
  bubbleSelected: {
    borderColor: '#FF5B22',
    borderWidth: 2,
    shadowColor: '#FF5B22',
    shadowOpacity: 0.6,
  },
  icon: {
    fontSize: 14,
  },
  id: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  riskDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#1C1C1C',
  },
  pointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#2C2C2E',
    marginTop: -1,
  },
  pointerSelected: {
    borderTopColor: '#FF5B22',
  },
});
