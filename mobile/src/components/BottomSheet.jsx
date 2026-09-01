/**
 * Custom animated bottom sheet using React Native's core Animated + PanResponder.
 * Works in Expo Go without any native dependency installation.
 * Snap points: 15% | 50% | 90% of screen height.
 */
import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  Dimensions,
  Platform,
} from 'react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// How much of the screen is *visible* at each snap (bottom-up perspective)
const SNAP_PERCENTS = [0.13, 0.50, 0.92];
const SNAP_HEIGHTS = SNAP_PERCENTS.map(p => SCREEN_HEIGHT * p);

function getClosestSnap(currentY) {
  const currentVisible = SCREEN_HEIGHT - currentY;
  let closest = 0;
  let minDiff = Infinity;
  SNAP_HEIGHTS.forEach((sh, i) => {
    const diff = Math.abs(currentVisible - sh);
    if (diff < minDiff) {
      minDiff = diff;
      closest = i;
    }
  });
  return closest;
}

const BottomSheet = forwardRef(({ children, initialSnap = 0 }, ref) => {
  const initialY = SCREEN_HEIGHT - SNAP_HEIGHTS[initialSnap];
  const translateY = useRef(new Animated.Value(initialY)).current;
  const currentSnapRef = useRef(initialSnap);
  const panStartY = useRef(0);

  const snapTo = useCallback((snapIndex, duration = 320) => {
    currentSnapRef.current = snapIndex;
    const targetY = SCREEN_HEIGHT - SNAP_HEIGHTS[snapIndex];
    Animated.spring(translateY, {
      toValue: targetY,
      useNativeDriver: true,
      damping: 30,
      stiffness: 280,
      mass: 0.8,
    }).start();
  }, [translateY]);

  useImperativeHandle(ref, () => ({
    snapTo,
    snapToIndex: snapTo,
  }));

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dy) > 5,
      onPanResponderGrant: () => {
        panStartY.current = translateY._value;
      },
      onPanResponderMove: (_, gestureState) => {
        const newY = panStartY.current + gestureState.dy;
        const minY = SCREEN_HEIGHT - SNAP_HEIGHTS[SNAP_HEIGHTS.length - 1];
        const maxY = SCREEN_HEIGHT - SNAP_HEIGHTS[0];
        const clampedY = Math.max(minY, Math.min(maxY, newY));
        translateY.setValue(clampedY);
      },
      onPanResponderRelease: (_, gestureState) => {
        const velocity = gestureState.vy;
        let targetSnap = getClosestSnap(translateY._value);
        // Velocity-assisted snap: flick up → go higher, flick down → go lower
        if (Math.abs(velocity) > 0.5) {
          if (velocity < 0) {
            targetSnap = Math.min(targetSnap + 1, SNAP_HEIGHTS.length - 1);
          } else {
            targetSnap = Math.max(targetSnap - 1, 0);
          }
        }
        currentSnapRef.current = targetSnap;
        const targetY = SCREEN_HEIGHT - SNAP_HEIGHTS[targetSnap];
        Animated.spring(translateY, {
          toValue: targetY,
          useNativeDriver: true,
          damping: 30,
          stiffness: 280,
          mass: 0.8,
          velocity: gestureState.vy,
        }).start();
      },
    })
  ).current;

  return (
    <Animated.View
      style={[styles.sheet, { transform: [{ translateY }] }]}
    >
      {/* Drag Handle */}
      <View style={styles.handleArea} {...panResponder.panHandlers}>
        <View style={styles.handle} />
      </View>
      {/* Content */}
      <View style={styles.content}>
        {children}
      </View>
    </Animated.View>
  );
});

BottomSheet.displayName = 'BottomSheet';
export default BottomSheet;

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SCREEN_HEIGHT,
    backgroundColor: '#2C2C2E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 24,
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  content: {
    flex: 1,
  },
});
