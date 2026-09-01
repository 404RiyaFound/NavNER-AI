/**
 * Photo capture button with thumbnail preview.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';

export function PhotoCapture({ photo, onCapture }) {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.captureButton}
        onPress={onCapture}
        activeOpacity={0.7}
      >
        <Text style={styles.cameraIcon}>📷</Text>
        <Text style={styles.captureText}>Capture Geo-Tagged Photo</Text>
      </TouchableOpacity>

      {photo ? (
        <View style={styles.previewContainer}>
          <Image source={{ uri: photo }} style={styles.preview} />
          <View style={styles.previewOverlay}>
            <Text style={styles.previewLabel}>📍 Geo-tagged</Text>
          </View>
        </View>
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderIcon}>🖼️</Text>
          <Text style={styles.placeholderText}>No photo captured yet</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    marginTop: 4,
  },
  captureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 18,
  },
  cameraIcon: {
    fontSize: 22,
  },
  captureText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3b82f6',
  },
  previewContainer: {
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  preview: {
    width: '100%',
    height: 160,
    borderRadius: 10,
  },
  previewOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  previewLabel: {
    fontSize: 11,
    color: '#22c55e',
    fontWeight: '600',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 80,
    backgroundColor: 'rgba(20, 35, 65, 0.5)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.08)',
    gap: 6,
  },
  placeholderIcon: {
    fontSize: 24,
    opacity: 0.4,
  },
  placeholderText: {
    fontSize: 12,
    color: '#5a6b82',
  },
});
