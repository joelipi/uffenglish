import os

def process_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        replacements = [
            ('QuestionLoader', 'ScreenLoader'),
            ('loadVideoForQuestion', 'loadVideoForScreen'),
            ('resetUIForNewQuestion', 'resetUIForNewScreen'),
            ('resetMicStatusWithQuestion', 'resetMicStatusWithScreen'),
            ('currentQuestion', 'currentScreen'),
            ('_getQuestionCue', '_getScreenCue'),
            ('defaultQuestions', 'defaultScreens'),
            ('aiQuestions', 'aiScreens'),
            ('resolvedQuestionIndex', 'resolvedScreenIndex'),
            ('_loadQuestion', '_loadScreen'),
            ('fadeInQuestion', 'fadeInScreen'),
            ('loadQuestion', 'loadScreen')
        ]

        new_content = content
        for old, new in replacements:
            new_content = new_content.replace(old, new)

        if new_content != content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Updated {filepath}")
    except Exception as e:
        pass

files = [
    'js/components/screen-loader.web.js',
    'js/components/ui.js',
    'js/modules/api.js',
    'js/modules/lesson-router.js',
    'js/modules/video-processor-logic.js',
    'js/modules/config-normalizer.js',
    'js/modules/video-loader.web.js',
    'js/modules/answers.js',
    'js/modules/storage.web.js',
    'js/app.js',
    'style.css',
    'hesitation_scoring_brief.md'
]

for f in files:
    process_file(f)
