/**
 * KPI Carousel — horizontally swipeable cards showing key performance indicators.
 * Card 1: Active Trips (solid orange), Card 2: Running Fleet, Card 3: Critical Risks.
 */
import React, { useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 48; // 24px padding each side

const KPI_CARDS = (data) => [
  {
    id: 'active-trips',
    label: 'Active Trips',
    value: data.activeTrips,
    unit: 'trips',
    icon: '🚚',
    accent: true,
    sub: `${data.onTimeRate}% on-time rate`,
  },
  {
    id: 'running-fleet',
    label: 'Running Fleet',
    value: data.runningFleet,
    unit: 'vehicles',
    icon: '🛣️',
    accent: false,
    sub: `${data.reroutes} rerouted today`,
  },
  {
    id: 'critical-risks',
    label: 'Critical Risks',
    value: data.criticalRisks,
    unit: 'alerts',
    icon: '⚠️',
    accent: false,
    sub: 'AI-detected anomalies',
    danger: true,
  },
];

export function KPICarousel({ data }) {
  const cards = KPI_CARDS(data);

  return (
    <View style={styles.wrapper}>
      <Text style={styles.sectionLabel}>Key Performance Indicators</Text>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        snapToInterval={CARD_WIDTH + 12}
        decelerationRate="fast"
      >
        {cards.map((card) => (
          <View
            key={card.id}
            style={[
              styles.card,
              { width: CARD_WIDTH },
              card.accent && styles.cardAccent,
              card.danger && styles.cardDanger,
            ]}
          >
            <View style={styles.cardTop}>
              <Text style={styles.cardIcon}>{card.icon}</Text>
              <Text style={[styles.cardLabel, card.accent && styles.cardLabelAccent]}>
                {card.label}
              </Text>
            </View>
            <Text style={[styles.cardValue, card.accent && styles.cardValueAccent]}>
              {card.value}
              <Text style={[styles.cardUnit, card.accent && styles.cardUnitAccent]}>
                {' '}{card.unit}
              </Text>
            </Text>
            <Text style={[styles.cardSub, card.accent && styles.cardSubAccent]}>
              {card.sub}
            </Text>
          </View>
        ))}
      </ScrollView>
      {/* Page Dots */}
      <View style={styles.dots}>
        {cards.map((card, i) => (
          <View key={card.id} style={[styles.dot, i === 0 && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 24,
  },
  scrollContent: {
    paddingHorizontal: 24,
    gap: 12,
  },
  card: {
    backgroundColor: '#3A3A3C',
    borderRadius: 20,
    padding: 22,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardAccent: {
    backgroundColor: '#FF5B22',
    borderColor: 'rgba(255,91,34,0.3)',
    shadowColor: '#FF5B22',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 12,
  },
  cardDanger: {
    borderColor: 'rgba(239,68,68,0.3)',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardIcon: {
    fontSize: 20,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  cardLabelAccent: {
    color: 'rgba(255,255,255,0.8)',
  },
  cardValue: {
    fontSize: 42,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 48,
  },
  cardValueAccent: {
    color: '#FFFFFF',
  },
  cardUnit: {
    fontSize: 16,
    fontWeight: '400',
    color: '#6B7280',
  },
  cardUnitAccent: {
    color: 'rgba(255,255,255,0.7)',
  },
  cardSub: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  cardSubAccent: {
    color: 'rgba(255,255,255,0.7)',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3A3A3C',
  },
  dotActive: {
    backgroundColor: '#FF5B22',
    width: 18,
  },
});
