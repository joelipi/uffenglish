// MicrophoneToggle.native.jsx — React Native stub
// TODO: Implement with React Native TouchableOpacity and native mic APIs.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { appStore } from '../../modules/store/store.js';

export default function MicrophoneToggleNative() {
    return (
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => appStore.getState().triggerPauseAllVideos()}>
                <Text style={{ color: '#fff' }}>Mic (RN stub)</Text>
            </TouchableOpacity>
        </View>
    );
}
