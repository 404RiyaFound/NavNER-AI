/**
 * Incident report form with type dropdown and description.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Modal, FlatList } from 'react-native';

const INCIDENT_TYPES = [
  { label: '⛰️  Landslide', value: 'landslide' },
  { label: '🌊  Flood', value: 'flood' },
  { label: '🚧  Road Damage', value: 'road_damage' },
  { label: '🌉  Bridge Collapse', value: 'bridge_collapse' },
];

export function IncidentForm({ incidentType, onTypeChange, description, onDescriptionChange }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const selectedLabel = INCIDENT_TYPES.find(t => t.value === incidentType)?.label || 'Select Incident Type';

  return (
    <View style={styles.container}>
      {/* Dropdown */}
      <Text style={styles.label}>Incident Type</Text>
      <TouchableOpacity
        style={styles.dropdown}
        onPress={() => setDropdownOpen(true)}
        activeOpacity={0.7}
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
                  <Text style={[
                    styles.modalItemText,
                    incidentType === item.value && styles.modalItemTextActive,
                  ]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Description */}
      <Text style={styles.label}>Severity / Description</Text>
      <TextInput
        style={styles.textArea}
        placeholder="Describe the situation, estimated severity, and impact on logistics..."
        placeholderTextColor="#5a6b82"
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        value={description}
        onChangeText={onDescriptionChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8a9bb5',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 8,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(20, 35, 65, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.15)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  dropdownText: {
    fontSize: 15,
    color: '#e8edf5',
  },
  placeholder: {
    color: '#5a6b82',
  },
  chevron: {
    fontSize: 14,
    color: '#8a9bb5',
  },
  textArea: {
    backgroundColor: 'rgba(20, 35, 65, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.15)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#e8edf5',
    fontSize: 14,
    minHeight: 100,
    lineHeight: 20,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 40,
  },
  modalContent: {
    backgroundColor: '#0e1a32',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#e8edf5',
    marginBottom: 14,
  },
  modalItem: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  modalItemActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
  },
  modalItemText: {
    fontSize: 15,
    color: '#8a9bb5',
  },
  modalItemTextActive: {
    color: '#3b82f6',
    fontWeight: '600',
  },
});
