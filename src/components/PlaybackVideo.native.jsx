// PlaybackVideo.native.jsx — React Native stub
// TODO: Implement with expo-av Video component once RN app is scaffolded.
// Shares usePlaybackVideo hook with the web version.

import React from 'react';
import { View, Text } from 'react-native';
import { usePlaybackVideo } from '../hooks/usePlaybackVideo.js';

export default function PlaybackVideoNative() {
    const { blob, isMuted, visible, toggleMute } = usePlaybackVideo();

    if (!blob) return null;

    return (
        <View style={{ position: 'absolute', top: '15%', left: 0, right: 0, zIndex: 5, display: visible ? 'flex' : 'none' }}>
            <Text style={{ color: '#fff' }}>Playback Video (RN stub)</Text>
        </View>
    );
}
