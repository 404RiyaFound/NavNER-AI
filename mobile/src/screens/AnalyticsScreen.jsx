/**
 * Analytics Screen — Mobile Command Center.
 * Issue #36: KPI Carousel, AI Delay Matrix, Reroute Audit Timeline.
 * Matches the desktop /analytics dashboard, adapted for mobile.
 */
import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  StatusBar,
  Platform,
  SafeAreaView,
} from 'react-native';
import { KPICarousel } from '../components/KPICarousel';
import { DelayMatrix } from '../components/DelayMatrix';
import { RerouteTimeline } from '../components/RerouteTimeline';
import { FLEET_TRUCKS, REROUTE_TIMELINE, KPI_DATA } from '../services/mockFleet';

export function AnalyticsScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#1C1C1C" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Command Center</Text>
          <Text style={styles.headerSub}>Mobile Analytics Dashboard</Text>
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveBadgeText}>Live</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Widget 1: KPI Carousel */}
        <KPICarousel data={KPI_DATA} />

        {/* Divider */}
        <View style={styles.divider} />

        {/* Widget 2: AI Delay Matrix */}
        <DelayMatrix trucks={FLEET_TRUCKS} />

        {/* Divider */}
        <View style={styles.divider} />

        {/* Widget 3: Reroute Audit Timeline */}
        <RerouteTimeline events={REROUTE_TIMELINE} />

        {/* AI Attribution Footer */}
        <View style={styles.aiFooter}>
          <Text style={styles.aiFooterIcon}>🤖</Text>
          <Text style={styles.aiFooterText}>
            Predictions powered by NavNER AI — processing severity, weather, and route data in real-time.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#1C1C1C',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 12 : 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
    fontWeight: '500',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.2)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
  },
  liveBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#22C55E',
    letterSpacing: 0.5,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 20,
    paddingBottom: 120,
    gap: 8,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginHorizontal: 24,
    marginVertical: 12,
  },
  aiFooter: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 24,
    marginTop: 8,
    padding: 16,
    backgroundColor: '#2C2C2E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  aiFooterIcon: {
    fontSize: 16,
  },
  aiFooterText: {
    flex: 1,
    fontSize: 11,
    color: '#6B7280',
    lineHeight: 16,
    fontWeight: '500',
  },
});
