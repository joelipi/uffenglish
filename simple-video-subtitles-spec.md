# Specification: Expanding Subtitles Handling for `simpleVideoPlayer`

## Rationale
Currently, the `simpleVideoPlayer` displays subtitles as a continuous scroll without timestamps. The goal is to enhance this by adding support for SRT-formatted timestamps within the subtitle string itself (not an external `.srt` file).

When a subtitle string contains proper SRT timestamps (e.g., `00:00:01,000 --> 00:00:04,500`), the player should parse these and display the text at the correct times, mimicking traditional subtitle behavior without scrolling. If no timestamps are detected, the player should default back to the existing scroll behavior as a fallback.

This approach provides a more native viewing experience for videos with precise timing needs while maintaining backwards compatibility with existing plain-text subtitles.

## Separation of Logic from DOM Manipulation
To ensure a strict separation of concerns and to support both Vanilla JS Web and React Native environments, all parsing logic and time-based state math must be isolated in the platform-agnostic `SimpleVideoStateController`. The UI components (`simple-video-player.js` for Web, and `simple-video-player.native.jsx` for React Native) will only subscribe to state changes and manipulate the DOM or Native Views accordingly.

## Files to be Edited
*   `js/modules/video-controller.js`: This file will be renamed to `js/modules/simple-video-controller.js` and the class renamed to `SimpleVideoStateController` to accurately reflect its scope. It will be updated to handle subtitle parsing, time conversions, and tracking the active timed subtitle index based on video progress.
*   `js/components/simple-video-player.js`: The Vanilla JS UI component for web. It will be updated to subscribe to the controller for subtitle updates, apply CSS classes for the timed view, and update `.innerHTML` dynamically without mingling parsing logic.
*   `js/components/simple-video-player.native.jsx`: The React Native UI component. It will be updated to handle displaying timed subtitles alongside the existing ScrollView fallback, relying strictly on the `SimpleVideoStateController`.
*   `js/config/gt2.json`: The course configuration file. We will update the first lesson's `simpleVideoUrl` question to include the new SRT formatted subtitles as an example.

## Existing Files to be Called (Not Edited)
*   `js/modules/video-loader.web.js`: This module instantiates `simpleVideoPlayer` and passes the localized subtitle string via the config object. It will remain unchanged.
*   `js/app.js` or other entry points that trigger the video loader.

---

## 1. Changes to `js/modules/simple-video-controller.js` (Pure Logic)

### Rename Class
Ensure the class is renamed:
```javascript
export class SimpleVideoStateController {
    // ...
}
```

### New State Variables
Add new properties to track the subtitle mode and parsed data in the constructor:
```javascript
this.state = {
    isPlaying: false,
    isLoaded: false,
    scrollRatio: 0,
    isTimedSubtitles: false,
    timedSubtitles: [], // Array of objects: { start, end, text }
    activeSubtitleText: '' // The exact string to display at the current time
};
```

### New Method: `parseSubtitles(subtitlesText)`
Called during initialization to analyze the subtitle string.
```javascript
initSubtitles(text) {
  if (!text || typeof text !== 'string') return;
  if (!text.includes('-->')) {
      // Fallback to scrolling mode
      this.setState({ isTimedSubtitles: false, activeSubtitleText: text });
      return;
  }

  const blocks = text.trim().split(/\n\s*\n/);
  const parsed = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    let timeLineIndex = lines.findIndex(line => line.includes('-->'));
    if (timeLineIndex === -1) continue;

    const timeString = lines[timeLineIndex];
    const textLines = lines.slice(timeLineIndex + 1).join('<br>');

    const [startStr, endStr] = timeString.split('-->').map(s => s.trim());

    const start = this._timeToSeconds(startStr);
    const end = this._timeToSeconds(endStr);

    if (!isNaN(start) && !isNaN(end)) {
        parsed.push({ start, end, text: textLines });
    }
  }

  this.setState({
      isTimedSubtitles: parsed.length > 0,
      timedSubtitles: parsed,
      activeSubtitleText: ''
  });
}
```

### New Helper: `_timeToSeconds(timeStr)`
Converts an SRT timestamp to seconds.
```javascript
_timeToSeconds(timeStr) {
  const parts = timeStr.split(':');
  if (parts.length < 3) return 0;

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const secondsParts = parts[2].split(',');
  const seconds = parseInt(secondsParts[0], 10);
  const milliseconds = secondsParts[1] ? parseInt(secondsParts[1], 10) : 0;

  return (hours * 3600) + (minutes * 60) + seconds + (milliseconds / 1000);
}
```

### Update `updateProgress(currentTime, duration)`
Update this existing method to handle both timed text and scroll calculations.
```javascript
updateProgress(currentTime, duration) {
    let updates = {};

    // Scroll calculation
    if (this.config.scrollSubtitles && duration && duration > 0 && !isNaN(duration)) {
        updates.scrollRatio = Math.max(0, Math.min(0.95, (currentTime / duration) * this.config.scrollSpeed));
    }

    // Timed text calculation
    if (this.state.isTimedSubtitles) {
        let foundText = '';
        for (let i = 0; i < this.state.timedSubtitles.length; i++) {
            const sub = this.state.timedSubtitles[i];
            if (currentTime >= sub.start && currentTime <= sub.end) {
                foundText = sub.text;
                break;
            }
        }
        if (foundText !== this.state.activeSubtitleText) {
            updates.activeSubtitleText = foundText;
        }
    }

    if (Object.keys(updates).length > 0) {
        this.setState(updates);
    }
}
```

---

## 2. Changes to `js/components/simple-video-player.js` (Web UI)
Refactor the web UI to rely heavily on the `SimpleVideoStateController`.

### Initialization
Initialize the controller and pass it the subtitle text.
```javascript
this.controller = new SimpleVideoStateController(this.config);
this.controller.initSubtitles(this.config.subtitles);

this.unsubscribe = this.controller.subscribe(state => this.render(state));
```

### Update `render(state)` Method
Remove pure logic from the web class and only react to state. Note the strict usage of `.innerHTML` and CSS classes instead of inline styles.
```javascript
render(state) {
    if (state.isTimedSubtitles) {
        this.subtitleScrollContainer.classList.add('timed-subtitles-container');
        this.subtitleDisplay.classList.add('timed-subtitles');
        this.subtitleDisplay.innerHTML = state.activeSubtitleText;
        // Transform is reset via CSS class, no scroll logic needed here
    } else {
        this.subtitleScrollContainer.classList.remove('timed-subtitles-container');
        this.subtitleDisplay.classList.remove('timed-subtitles');
        // Apply scrolling behavior based on state.scrollRatio
        const containerHeight = this.subtitleScrollContainer.offsetHeight;
        const contentHeight = this.subtitleDisplay.scrollHeight;
        const maxScroll = Math.max(0, contentHeight - containerHeight);
        const currentScroll = state.scrollRatio * maxScroll;
        this.subtitleDisplay.style.transform = `translateY(-${currentScroll}px)`;
    }
}
```
*Note: The styles for `timed-subtitles-container` and `timed-subtitles` must be added to `style.css`.*

---

## 3. Changes to `js/components/simple-video-player.native.jsx` (React Native UI)
Update the React Native component to support the new state variables and the renamed `SimpleVideoStateController`.

### Update Controller Import
```javascript
import { SimpleVideoStateController } from '../modules/simple-video-controller.js';
```

### Update `useEffect` hook
```javascript
useEffect(() => {
    // Initialize controller subtitles once mounted
    controllerRef.current.initSubtitles(subtitles);

    const unsub = controllerRef.current.subscribe(state => {
        setIsPlaying(state.isPlaying);
        setIsLoaded(state.isLoaded);
        setScrollRatio(state.scrollRatio);
        setIsTimed(state.isTimedSubtitles);
        setActiveText(state.activeSubtitleText);
    });
    return unsub;
}, [subtitles]);
```

### Update the JSX Return
Render based on whether it is timed or scrolling.
```jsx
{subtitles ? (
    <View
        style={styles.subtitleScrollContainer}
        onLayout={e => {
            subtitleContainerHeight.current = e.nativeEvent.layout.height;
        }}
        pointerEvents="none"
    >
        {isTimed ? (
            <Text style={styles.timedSubtitleText}>
                {activeText.replace(/<br>/g, '\n')}
            </Text>
        ) : (
            <ScrollView
                ref={scrollViewRef}
                scrollEnabled={false}
                showsVerticalScrollIndicator={false}
            >
                <Text
                    style={styles.subtitleText}
                    onLayout={e => {
                        subtitleContentHeight.current = e.nativeEvent.layout.height;
                    }}
                >
                    {subtitles}
                </Text>
            </ScrollView>
        )}
    </View>
) : null}
```

---

## 4. Update Example in `js/config/gt2.json`
We will update the first lesson (`"lessonId": "a"`), specifically the second question which has `simpleVideoUrl: "gtests-1-0"`, to use SRT formatting in its `subtitles` property for all languages.

```json
{
  "question": "SIMPLEVIDEOURL + SPEECH INPUTTYPE. Watch video then say: I LOVE ENGLISH!",
  "cue": {
    "en": "I love English!",
    "es": "¡Amo el inglés!",
    "pt": "Eu amo o inglês!"
  },
  "inputType": "speech",
  "simpleVideoUrl": "gtests-1-0",
  "subtitles": {
    "en": "1\n00:00:00,500 --> 00:00:03,000\nLet's do a role play ordering a drink.\n\n2\n00:00:03,500 --> 00:00:06,000\nYou'll be the customer. I'll sell you the drink.\n\n3\n00:00:06,500 --> 00:00:10,000\nFirst, let's warm up our microphones and our mouths. Say: I LOVE ENGLISH!",
    "es": "1\n00:00:00,500 --> 00:00:03,000\nVamos a hacer un role play de pedir una bebida.\n\n2\n00:00:03,500 --> 00:00:06,000\nTú serás el cliente y yo te venderé la bebida.\n\n3\n00:00:06,500 --> 00:00:10,000\nPrimero vamos a calentar nuestros micrófonos y nuestras bocas. Di: I LOVE ENGLISH!",
    "pt": "1\n00:00:00,500 --> 00:00:03,000\nVamos fazer um role play pidiendoo uma bebida...\n\n2\n00:00:03,500 --> 00:00:06,000\nVocê será o cliente e eu venderei a bebida.\n\n3\n00:00:06,500 --> 00:00:10,000\nPrimeiro vamos aquecer nossos microfones e bocas. Diga: I LOVE ENGLISH!"
  },
  "headsUp": "A continuación: vas a ver el contexto del role play que vamos a hacer."
}
```
