/**
 * StepLoader.jsx — React Step Loader (Web)
 *
 * A proper React component that renders step content declaratively.
 * No DOM manipulation, no portals into static HTML.
 */

import React from 'react';

function UnknownStepType({ stepType }) {
    return (
        <div className="unknown-step-type">
            <p>Unknown step type: {stepType}</p>
        </div>
    );
}

function LessonIntroStep({ step, lesson }) {
    const hasExplanation = step.explanation && !step.simpleVideoUrl;
    return (
        <div className="step-lesson-intro">
            <div className="chat-message-row chat-message-row--system">
                <div className="chat-message-bubble chat-message-bubble--system">
                    <p className="lesson-name">
                        <strong>Lesson: {lesson?.title}</strong>
                    </p>
                    {hasExplanation && (
                        <p className="explanation">{step.explanation}</p>
                    )}
                </div>
            </div>
        </div>
    );
}

function PresentStep({ step, lesson }) {
    if (!step.simpleVideoUrl) return null;
    return (
        <div className="step-present">
            <div className="chat-message-row chat-message-row--system">
                <div className="chat-message-bubble chat-message-bubble--system">
                    <p className="lesson-name">
                        <strong>Lesson: {lesson?.title}</strong>
                    </p>
                    {step.explanation && (
                        <p className="explanation">{step.explanation}</p>
                    )}
                </div>
            </div>
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
    return (
        <div className="step-success">
            <div className="chat-message-row chat-message-row--system">
                <div className="chat-message-bubble chat-message-bubble--system">
                    <p className="lesson-name">
                        <strong>Lesson Complete!</strong>
                    </p>
                </div>
            </div>
        </div>
    );
}

export default function StepLoader({ step, lesson }) {
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
