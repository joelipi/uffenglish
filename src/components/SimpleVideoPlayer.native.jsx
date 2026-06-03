// SimpleVideoPlayer.native.jsx — React Native stub
// TODO: Implement with expo-av Video component once RN app is scaffolded.
// Shares useSimpleVideo hook with the web version.

import React from 'react';
import { View, Text } from 'react-native';
import { useSimpleVideo } from '../hooks/useSimpleVideo.js';

export default function SimpleVideoPlayerNative() {
    const { isActive, subtitleText } = useSimpleVideo();

    if (!isActive) return null;

    return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
            <Text style={{ color: '#fff' }}>Simple Video Player (RN stub)</Text>
            {subtitleText && <Text style={{ color: '#fff', marginTop: 20 }}>{subtitleText}</Text>}
        </View>
    );
}
