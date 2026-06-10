/**
 * StepLoader.native.jsx — React Native Step Loader (Stub)
 *
 * Placeholder for React Native implementation.
 * TODO: Implement with React Native components and native speech recognition.
 */

import React from 'react';
import { View, Text } from 'react-native';

export default function StepLoader({ step, lesson }) {
    if (!step) return null;

    return (
        <View>
            <Text>StepLoader Native — responseType: {step.responseType}</Text>
        </View>
    );
}
