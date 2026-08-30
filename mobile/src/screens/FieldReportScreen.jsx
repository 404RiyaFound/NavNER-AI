/**
 * Field Report Screen — Main screen for the NER Logistics Field App.
 * Supports offline incident submission with sync queue.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Animated,
  Platform,
  StatusBar,
  Alert,
} from 'react-native';
import { NetworkBadge } from '../components/NetworkBadge';
import { IncidentForm } from '../components/IncidentForm';
import { PhotoCapture } from '../components/PhotoCapture';
import { enqueue, syncQueue, getQueue } from '../services/syncQueue';

// Mock GPS location (Guwahati area) — in production, use expo-location
const MOCK_LOCATION = { lat: 26.1445, lng: 91.7362 };

export function FieldReportScreen() {
  const [isOnline, setIsOnline] = useState(true);
  const [incidentType, setIncidentType] = useState('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [savedToQueue, setSavedToQueue] = useState(false);
  const [queueCount, setQueueCount] = useState(0);

  // Snackbar animation
  const snackbarAnim = useRef(new Animated.Value(0)).current;

  // Check network status (mock toggle for demo)
  // In production, use @react-native-community/netinfo
  useEffect(() => {
    updateQueueCount();
  }, []);

  const updateQueueCount = async () => {
    const queue = await getQueue();
    setQueueCount(queue.length);
  };

  const showSnackbar = useCallback(() => {
    Animated.sequence([
      Animated.timing(snackbarAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(snackbarAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [snackbarAnim]);

  const handleCapture = () => {
    // Mock photo capture
    setPhoto('https://picsum.photos/400/300');
  };

  const handleSubmit = async () => {
    if (!incidentType) {
      Alert.alert('Missing Field', 'Please select an incident type.');
      return;
    }

    setSubmitting(true);

    const report = {
      type: incidentType,
      lat: MOCK_LOCATION.lat,
      lng: MOCK_LOCATION.lng,
      description,
      photoUri: photo,
    };

    if (isOnline) {
      // Simulate online submission
      await new Promise(resolve => setTimeout(resolve, 1500));
      setSubmitted(true);
      setTimeout(() => {
        resetForm();
      }, 2000);
    } else {
      // Save to offline queue
      await enqueue(report);
      await updateQueueCount();
      setSavedToQueue(true);
      showSnackbar();
      setTimeout(() => {
        resetForm();
      }, 2000);
    }

    setSubmitting(false);
  };

  const resetForm = () => {
    setIncidentType('');
    setDescription('');
    setPhoto(null);
    setSubmitted(false);
    setSavedToQueue(false);
  };

  const toggleNetwork = () => {
    setIsOnline(prev => !prev);
  };

  const getButtonText = () => {
    if (submitting) return '';
    if (submitted) return '✅ Report Submitted';
    if (savedToQueue) return '📦 Saved to Sync Queue';
    return 'Submit Report';
  };

  const getButtonStyle = () => {
    if (submitted) return [styles.submitButton, styles.submitSuccess];
    if (savedToQueue) return [styles.submitButton, styles.submitQueued];
    if (!incidentType) return [styles.submitButton, styles.submitDisabled];
    return [styles.submitButton];
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#060d1a" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>NER Logistics Field App</Text>
          <Text style={styles.headerSubtitle}>Field Incident Reporting</Text>
        </View>
        <TouchableOpacity onPress={toggleNetwork}>
          <NetworkBadge isOnline={isOnline} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Map Preview */}
        <View style={styles.mapPreview}>
          <View style={styles.mapPlaceholder}>
            <Text style={styles.mapPin}>📍</Text>
            <Text style={styles.mapCoords}>
              {MOCK_LOCATION.lat.toFixed(4)}°N, {MOCK_LOCATION.lng.toFixed(4)}°E
            </Text>
            <Text style={styles.mapLabel}>Your Current Location — Guwahati, Assam</Text>
          </View>
        </View>

        {/* Incident Form */}
        <IncidentForm
          incidentType={incidentType}
          onTypeChange={setIncidentType}
          description={description}
          onDescriptionChange={setDescription}
        />

        {/* Photo Capture */}
        <PhotoCapture photo={photo} onCapture={handleCapture} />

        {/* Queue Count */}
        {queueCount > 0 && (
          <View style={styles.queueBanner}>
            <Text style={styles.queueText}>
              📦 {queueCount} report{queueCount > 1 ? 's' : ''} pending sync
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Submit Button */}
      <View style={styles.submitContainer}>
        <TouchableOpacity
          style={getButtonStyle()}
          onPress={handleSubmit}
          disabled={submitting || submitted || savedToQueue || !incidentType}
          activeOpacity={0.8}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.submitText}>{getButtonText()}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Offline Snackbar */}
      <Animated.View
        style={[
          styles.snackbar,
          {
            opacity: snackbarAnim,
            transform: [{
              translateY: snackbarAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [50, 0],
              }),
            }],
          },
        ]}
      >
        <Text style={styles.snackbarText}>
          ⚠️ You are offline. Report saved locally and will sync when connectivity returns.
        </Text>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#060d1a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: 'rgba(14, 26, 50, 0.92)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(59, 130, 246, 0.12)',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 10 : 14,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#e8edf5',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#5a6b82',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 16,
    paddingBottom: 120,
  },
  // Map Preview
  mapPreview: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.15)',
  },
  mapPlaceholder: {
    height: 140,
    backgroundColor: 'rgba(14, 26, 50, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  mapPin: {
    fontSize: 28,
  },
  mapCoords: {
    fontSize: 13,
    color: '#3b82f6',
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  mapLabel: {
    fontSize: 11,
    color: '#5a6b82',
    marginTop: 2,
  },
  // Queue Banner
  queueBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  queueText: {
    fontSize: 13,
    color: '#f59e0b',
    fontWeight: '500',
  },
  // Submit
  submitContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    backgroundColor: 'rgba(6, 13, 26, 0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(59, 130, 246, 0.12)',
  },
  submitButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  submitDisabled: {
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitSuccess: {
    backgroundColor: '#22c55e',
    shadowColor: '#22c55e',
  },
  submitQueued: {
    backgroundColor: '#f59e0b',
    shadowColor: '#f59e0b',
  },
  submitText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  // Snackbar
  snackbar: {
    position: 'absolute',
    bottom: 90,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(239, 68, 68, 0.95)',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  snackbarText: {
    fontSize: 13,
    color: '#ffffff',
    fontWeight: '500',
    lineHeight: 18,
  },
});
