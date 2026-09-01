/**
 * Incident report form — redesigned for Issue #36.
 * Theme: Deep Charcoal (#1C1C1C) + Vibrant Orange (#FF5B22).
 * New fields: Severity Level (pill selector), ETC (numeric), Geo-Tag display.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  ScrollView,
} from 'react-native';

const INCIDENT_TYPES = [
  { label: '⛰️  Landslide', value: 'LANDSLIDE' },
  { label: '🌊  Flood', value: 'FLOOD' },
  { label: '🌉  Bridge Collapse', value: 'BRIDGE_COLLAPSE' },
  { label: '🚧  Road Block', value: 'ROAD_BLOCK' },
];

const SEVERITY_LEVELS = [
  { label: 'Low', value: 'LOW', color: '#22C55E' },
  { label: 'Moderate', value: 'MODERATE', color: '#FBBF24' },
  { label: 'High', value: 'HIGH', color: '#FF5B22' },
  { label: 'Critical', value: 'CRITICAL', color: '#EF4444' },
];

export function IncidentForm({
  incidentType,
  onTypeChange,
  severity,
  onSeverityChange,
  description,
  onDescriptionChange,
  estimatedClearanceHrs,
  onEtcChange,
  location,
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const selectedLabel =
    INCIDENT_TYPES.find(t => t.value === incidentType)?.label || 'Select Incident Type';

  return (
    <View style={styles.container}>

      {/* ── Incident Type Dropdown ── */}
      <Text style={styles.label}>Incident Type</Text>
      <TouchableOpacity
        style={styles.dropdown}
        onPress={() => setDropdownOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Select incident type"
      >
        <Text style={[styles.dropdownText, !incidentType && styles.placeholder]}>
          {selectedLabel}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={dropdownOpen} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setDropdownOpen(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Incident Type</Text>
            <FlatList
              data={INCIDENT_TYPES}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.modalItem,
                    incidentType === item.value && styles.modalItemActive,
                  ]}
                  onPress={() => {
                    onTypeChange(item.value);
                    setDropdownOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.modalItemText,
                      incidentType === item.value && styles.modalItemTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                  {incidentType === item.value && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Severity Level Pill Selector ── */}
      <Text style={styles.label}>Severity Level</Text>
      <View style={styles.severityRow}>
        {SEVERITY_LEVELS.map((s) => {
          const isActive = severity === s.value;
          return (
            <TouchableOpacity
              key={s.value}
              style={[
                styles.severityPill,
                isActive && { backgroundColor: s.color, borderColor: s.color },
              ]}
              onPress={() => onSeverityChange(s.value)}
              activeOpacity={0.7}
              accessibilityRole="radio"
              accessibilityState={{ selected: isActive }}
            >
              <Text
                style={[
                  styles.severityText,
                  isActive && styles.severityTextActive,
                ]}
              >
                {s.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Incident Description ── */}
      <Text style={styles.label}>Incident Description</Text>
      <TextInput
        style={styles.textArea}
        placeholder="Describe the situation in detail — road conditions, equipment needed, number of lanes affected..."
        placeholderTextColor="#6B7280"
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        value={description}
        onChangeText={onDescriptionChange}
        accessibilityLabel="Incident description"
      />

      {/* ── Estimated Time of Clearance ── */}
      <Text style={styles.label}>Estimated Clearance Time (Hours)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 6"
        placeholderTextColor="#6B7280"
        keyboardType="numeric"
        value={estimatedClearanceHrs}
        onChangeText={onEtcChange}
        maxLength={4}
        accessibilityLabel="Estimated clearance time in hours"
      />

      {/* ── Geo-Tag Display ── */}
      <Text style={styles.label}>Geo-Tag</Text>
      <View style={styles.geoTag}>
        <Text style={styles.geoIcon}>📍</Text>
        <Text style={styles.geoCoords}>
          {location
            ? `${location.lat.toFixed(5)}°N, ${location.lng.toFixed(5)}°E`
            : 'Fetching precise location...'}
        </Text>
        {location && <View style={styles.geoLiveDot} />}
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 14,
  },
  // Dropdown
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1C1C1C',
    borderWidth: 1,
    borderColor: '#3F3F46',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  dropdownText: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  placeholder: {
    color: '#6B7280',
  },
  chevron: {
    fontSize: 14,
    color: '#6B7280',
  },
  // Severity Pills
  severityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  severityPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 30,
    backgroundColor: '#1C1C1C',
    borderWidth: 1,
    borderColor: '#3F3F46',
  },
  severityText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  severityTextActive: {
    color: '#FFFFFF',
  },
  // Text Area
  textArea: {
    backgroundColor: '#1C1C1C',
    borderWidth: 1,
    borderColor: '#3F3F46',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    color: '#FFFFFF',
    fontSize: 14,
    minHeight: 110,
    lineHeight: 21,
  },
  // Numeric Input
  input: {
    backgroundColor: '#1C1C1C',
    borderWidth: 1,
    borderColor: '#3F3F46',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
  },
  // Geo-Tag
  geoTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1C1C1C',
    borderWidth: 1,
    borderColor: '#3F3F46',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  geoIcon: {
    fontSize: 16,
  },
  geoCoords: {
    flex: 1,
    fontSize: 13,
    color: '#9CA3AF',
    fontFamily: 'monospace',
    fontWeight: '500',
  },
  geoLiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 32,
  },
  modalContent: {
    backgroundColor: '#2C2C2E',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 14,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 4,
  },
  modalItemActive: {
    backgroundColor: 'rgba(255,91,34,0.12)',
  },
  modalItemText: {
    fontSize: 15,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  modalItemTextActive: {
    color: '#FF5B22',
    fontWeight: '700',
  },
  checkmark: {
    fontSize: 16,
    color: '#FF5B22',
    fontWeight: '700',
  },
});
