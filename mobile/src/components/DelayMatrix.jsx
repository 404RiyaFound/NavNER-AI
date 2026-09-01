/**
 * AI Delay Matrix — scrollable vertical list of vehicles
 * with horizontal orange progress bars indicating delay probability.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';

function DelayBar({ risk }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: risk / 100,
      duration: 900,
      delay: 200,
      useNativeDriver: false,
    }).start();
  }, [risk]);

  const barColor =
    risk >= 75 ? '#EF4444' :
    risk >= 40 ? '#FF5B22' : '#22C55E';

  return (
    <View style={styles.barTrack}>
      <Animated.View
        style={[
          styles.barFill,
          {
            backgroundColor: barColor,
            width: anim.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
      <Text style={[styles.barLabel, { color: barColor }]}>{risk}%</Text>
    </View>
  );
}

export function DelayMatrix({ trucks }) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.sectionLabel}>AI Delay Probability Matrix</Text>
      <View style={styles.card}>
        {trucks.map((truck, idx) => (
          <View
            key={truck.id}
            style={[styles.row, idx < trucks.length - 1 && styles.rowBorder]}
          >
            <View style={styles.truckInfo}>
              <Text style={styles.truckIcon}>{truck.cargoIcon}</Text>
              <View>
                <Text style={styles.truckId}>{truck.id}</Text>
                <Text style={styles.truckCargo}>{truck.cargo}</Text>
              </View>
            </View>
            <View style={styles.barWrapper}>
              <DelayBar risk={truck.delayRisk} />
            </View>
          </View>
        ))}
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
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  truckInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: 110,
  },
  truckIcon: {
    fontSize: 18,
  },
  truckId: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  truckCargo: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 1,
  },
  barWrapper: {
    flex: 1,
  },
  barTrack: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  barLabel: {
    position: 'absolute',
    right: 0,
    top: -16,
    fontSize: 10,
    fontWeight: '700',
  },
});
