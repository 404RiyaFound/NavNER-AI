/**
 * Photo capture button with thumbnail preview.
 * Re-skinned for Issue #36: Orange (#FF5B22) accent + dark charcoal theme.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';

export function PhotoCapture({ photo, onCapture }) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Image Verification</Text>
      <TouchableOpacity
        style={[styles.captureButton, photo && styles.captureButtonActive]}
        onPress={onCapture}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Capture geo-tagged photo"
      >
        <Text style={styles.cameraIcon}>📷</Text>
        <Text style={styles.captureText}>
          {photo ? 'Retake Photo' : 'Capture Geo-Tagged Photo'}
        </Text>
      </TouchableOpacity>

      {photo ? (
        <View style={styles.previewContainer}>
          <Image source={{ uri: photo }} style={styles.preview} />
          <View style={styles.previewOverlay}>
            <View style={styles.previewBadge}>
              <View style={styles.previewDot} />
              <Text style={styles.previewLabel}>Geo-tagged & Verified</Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderIcon}>🖼️</Text>
          <Text style={styles.placeholderText}>No photo captured yet</Text>
          <Text style={styles.placeholderSub}>
            Used for Command Center verification
          </Text>
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
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
    marginTop: 10,
  },
  captureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(255, 91, 34, 0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 91, 34, 0.35)',
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 18,
  },
  captureButtonActive: {
    backgroundColor: 'rgba(255, 91, 34, 0.12)',
    borderColor: '#FF5B22',
    borderStyle: 'solid',
  },
  cameraIcon: {
    fontSize: 20,
  },
  captureText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF5B22',
  },
  previewContainer: {
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  preview: {
    width: '100%',
    height: 170,
  },
  previewOverlay: {
    position: 'absolute',
    bottom: 10,
    left: 10,
  },
  previewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  previewDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
  },
  previewLabel: {
    fontSize: 11,
    color: '#22C55E',
    fontWeight: '700',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 90,
    backgroundColor: '#1C1C1C',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3F3F46',
    gap: 4,
  },
  placeholderIcon: {
    fontSize: 22,
    opacity: 0.35,
  },
  placeholderText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  placeholderSub: {
    fontSize: 10,
    color: '#4B5563',
  },
});
