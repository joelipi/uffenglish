import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store/store.js';

function UnknownStepType({ stepType }) {
    return (
        <div className="unknown-step-type">
            <p>Unknown step type: {stepType}</p>
        </div>
    );
}

function LessonIntroStep() {
    return <div className="step-lesson-intro"></div>;
}

function PresentStep({ step }) {
    if (!step.simpleVideoUrl) return null;
    return (
        <div className="step-present">
            {step.explanation && (
                <p className="explanation">{step.explanation}</p>
            )}
        </div>
    );
}

function ResponseStep({ step }) {
    return (
        <div className="step-response">
            {step.possibleAnswer && (
                <div className="possible-answer">
                    <strong>Possible response:</strong>
                    <p>{step.possibleAnswer}</p>
                </div>
            )}
        </div>
    );
}

function TextStep({ step }) {
    return (
        <div className="step-text">
            {step.explanation && (
                <p className="explanation">{step.explanation}</p>
            )}
        </div>
    );
}

function SuccessStep() {
    return <div className="step-success"></div>;
}

export default function StepLoader({ step, lesson }) {
    const completionMessage = useStore(appStore, (state) => state.completionMessage);

    if (completionMessage) {
        return (
            <div id="steps-container">
                <div className="text-center">
                    {completionMessage.heading && <h3>{completionMessage.heading}</h3>}
                    {completionMessage.body && <p>{completionMessage.body}</p>}
                </div>
            </div>
        );
    }

    if (!step) return null;

    switch (step.stepType) {
        case 'lessonIntro':
            return <LessonIntroStep step={step} lesson={lesson} />;
        case 'present':
            return <PresentStep step={step} lesson={lesson} />;
        case 'closedResponse':
        case 'openResponse':
            return <ResponseStep step={step} />;
        case 'text':
            return <TextStep step={step} />;
        case 'success':
            return <SuccessStep step={step} lesson={lesson} />;
        case 'lessoncomplete':
        case 'unitcomplete':
            return (
                <div className="step-complete">
                    <p>Lesson complete. Great job!</p>
                </div>
            );
        default:
            return <UnknownStepType stepType={step.stepType} />;
    }
}
