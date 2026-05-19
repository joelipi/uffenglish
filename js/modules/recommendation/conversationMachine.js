import { setup, assign } from 'xstate';
import { recommend } from './courseRecommender.js';
import { addNeverRecommend, persistNeverRecommend } from './neverRecommend.js';

export const conversationMachine = setup({
    types: {
        context: {},
        events: {},
        input: {}
    },
    actions: {
        hydrateContext: assign(({ event }) => {
            if (event.type === 'HYDRATE') {
                let streakMessage = null;
                const user = event.user || {};
                if (user.streak > 0) {
                    const previousStreak = event.previousStreak || 0;
                    const STREAK_CELEBRATION_THRESHOLD = 1;
                    if (user.streak > previousStreak && user.streak >= STREAK_CELEBRATION_THRESHOLD) {
                        streakMessage = `Congratulations! Your streak is now ${user.streak} days!`;
                    }
                }

                return {
                    user: user,
                    manifest: event.manifest || [],
                    sessionSkipped: event.sessionSkipped || [],
                    chatMode: event.chatMode || 'chat',
                    streakMessage: streakMessage
                };
            }
            return {};
        }),
        addToSessionSkipped: assign({
            sessionSkipped: ({ context, event }) => {
                const skippedId = event.courseId || (context.currentRecommendation ? context.currentRecommendation.courseId : null);
                if (skippedId) {
                    return [...context.sessionSkipped, skippedId];
                }
                return context.sessionSkipped;
            }
        }),
        recordNeverRecommend: ({ context, event }) => {
            const skippedId = event.courseId || (context.currentRecommendation ? context.currentRecommendation.courseId : null);
            if (skippedId) {
                addNeverRecommend(skippedId);
                persistNeverRecommend(skippedId);
            }
        },
        setRecommendationResult: assign({
            recommendationResult: ({ event }) => event.output,
            currentRecommendation: ({ event }) => {
                if (event.output.nextCourse) return event.output.nextCourse;
                if (event.output.courses && event.output.courses.length > 0) return event.output.courses[0];
                return null;
            }
        }),
        setError: assign({
            error: ({ event }) => {
                // If it's an error from promise, it will be in event.data
                const errMsg = event.data?.message || event.error || "An error occurred during recommendation.";
                return errMsg;
            }
        }),
        setChatMode: assign({
            chatMode: ({ event }) => event.mode || 'chat'
        })
    },
    actors: {
        fetchManifest: async () => {
            return Promise.resolve();
        },
        runRecommender: async ({ context }) => {
            try {
                const result = recommend({
                    user: context.user,
                    manifest: context.manifest,
                    sessionSkipped: context.sessionSkipped
                });
                return result;
            } catch (err) {
                throw new Error("Recommender threw an error: " + err.message);
            }
        }
    },
    guards: {
        hasNextCourse: ({ event }) => event.output?.status === 'presenting_next_course',
        hasResumable: ({ event }) => event.output?.status === 'resumable',
        hasFresh: ({ event }) => event.output?.status === 'fresh',
        hasFallback: ({ event }) => event.output?.status === 'fallback',
        isEmpty: ({ event }) => event.output?.status === 'empty'
    }
}).createMachine({
    id: 'conversation',
    initial: 'idle',
    context: ({ input }) => {
        let streakMessage = null;
        if (input?.user?.streak > 0) {
            const previousStreak = input.previousStreak || 0;
            const STREAK_CELEBRATION_THRESHOLD = 1;
            if (input.user.streak > previousStreak && input.user.streak >= STREAK_CELEBRATION_THRESHOLD) {
                streakMessage = `Congratulations! Your streak is now ${input.user.streak} days!`;
            }
        }

        return {
            user: input?.user || {},
            manifest: input?.manifest || [],
            recommendationResult: null,
            currentRecommendation: null,
            sessionSkipped: input?.sessionSkipped || [],
            chatMode: input?.chatMode || 'chat',
            streakMessage: streakMessage,
            error: null
        };
    },
    on: {
        SET_CHAT_MODE: {
            actions: 'setChatMode'
        },
        HYDRATE: {
            actions: 'hydrateContext'
        },
        FIND_LESSON: {
            target: '.filtering'
        },
        SHOW_STREAK: {
            target: '.idle'
        }
    },
    states: {
        idle: {
            on: {
                START: 'loading_manifest'
            }
        },
        loading_manifest: {
            invoke: {
                src: 'fetchManifest',
                onDone: 'filtering',
                onError: {
                    target: 'error',
                    actions: 'setError'
                }
            }
        },
        filtering: {
            invoke: {
                src: 'runRecommender',
                onDone: [
                    {
                        guard: 'hasNextCourse',
                        target: 'presenting_next_course',
                        actions: 'setRecommendationResult'
                    },
                    {
                        guard: 'hasResumable',
                        target: 'presenting_resumable',
                        actions: 'setRecommendationResult'
                    },
                    {
                        guard: 'hasFresh',
                        target: 'presenting_fresh',
                        actions: 'setRecommendationResult'
                    },
                    {
                        guard: 'hasFallback',
                        target: 'presenting_fallback',
                        actions: 'setRecommendationResult'
                    },
                    {
                        guard: 'isEmpty',
                        target: 'empty',
                        actions: 'setRecommendationResult'
                    }
                ],
                onError: {
                    target: 'error',
                    actions: 'setError'
                }
            }
        },
        presenting_next_course: {
            on: {
                // UI fires this right after rendering
                AWAIT: 'awaiting_response'
            }
        },
        presenting_resumable: {
            on: {
                AWAIT: 'awaiting_response'
            }
        },
        presenting_fresh: {
            on: {
                AWAIT: 'awaiting_response'
            }
        },
        presenting_fallback: {
            on: {
                AWAIT: 'awaiting_response'
            }
        },
        empty: {
            // Terminal state if nothing left
        },
        error: {
            // Terminal state
        },
        awaiting_response: {
            on: {
                ACCEPT: 'done',
                SKIP: {
                    target: 'filtering',
                    actions: 'addToSessionSkipped'
                },
                NEVER: {
                    target: 'filtering',
                    actions: [
                        'recordNeverRecommend',
                        'addToSessionSkipped'
                    ]
                },
                NEXT_COURSE_ACCEPT: 'done',
                NEXT_COURSE_SKIP: {
                    target: 'filtering',
                    actions: 'addToSessionSkipped'
                },
                FIND_LESSON: {
                    target: 'filtering'
                },
                SHOW_STREAK: {
                    // Could add a specific state, for now we just stay and UI can handle it or we re-trigger idle
                    target: 'idle'
                }
            }
        },
        done: {
            type: 'final'
        }
    }
});
