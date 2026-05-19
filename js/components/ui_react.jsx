import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const FlowScoreStat = ({ score }) => {
    return (
        <View style={styles.statsContainer}>
            <Text style={styles.chatBubbleHeader}>SPEAKING FLOW</Text>
            <Text style={styles.botScore}>{score}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    statsContainer: {
        alignItems: 'center',
        padding: 5,
    },
    chatBubbleHeader: {
        color: '#ccc',
        fontSize: 10,
        fontWeight: '600',
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    botScore: {
        color: '#4CAF50',
        fontSize: 20,
        fontWeight: 'bold',
    }
});
