/**
 * NER Logistics Field App — Root Entry
 * Issue #36: Multi-tab navigation shell with FloatingNavBar.
 * Tabs: Map | Analytics | Report Incident
 */
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { MapScreen } from './src/screens/MapScreen';
import { AnalyticsScreen } from './src/screens/AnalyticsScreen';
import { FieldReportScreen } from './src/screens/FieldReportScreen';
import { FloatingNavBar } from './src/components/FloatingNavBar';

export default function App() {
  const [activeTab, setActiveTab] = useState('map');

  return (
    <View style={styles.root}>
      {/* Screens — keep all mounted to preserve state */}
      <View style={[styles.screen, activeTab !== 'map' && styles.hidden]}>
        <MapScreen />
      </View>
      <View style={[styles.screen, activeTab !== 'analytics' && styles.hidden]}>
        <AnalyticsScreen />
      </View>
      <View style={[styles.screen, activeTab !== 'report' && styles.hidden]}>
        <FieldReportScreen />
      </View>

      {/* Floating Bottom Nav Bar — rendered above all screens */}
      <FloatingNavBar activeTab={activeTab} onTabChange={setActiveTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1C1C1C',
  },
  screen: {
    ...StyleSheet.absoluteFillObject,
  },
  hidden: {
    display: 'none',
  },
});
