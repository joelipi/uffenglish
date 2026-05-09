# Specification: Expanding Subtitles Handling for `simpleVideoPlayer`

## Rationale
Currently, the `simpleVideoPlayer` displays subtitles as a continuous scroll without timestamps. The goal is to enhance this by adding support for SRT-formatted timestamps within the subtitle string itself (not an external `.srt` file).

When a subtitle string contains proper SRT timestamps (e.g., `00:00:01,000 --> 00:00:04,500`), the player should parse these and display the text at the correct times, mimicking traditional subtitle behavior without scrolling. If no timestamps are detected, the player should default back to the existing scroll behavior as a fallback.

This approach provides a more native viewing experience for videos with precise timing needs while maintaining backwards compatibility with existing plain-text subtitles.

## Files to be Edited
*   `js/components/simple-video-player.js`: The core UI component for simple videos. This file will contain the logic for parsing SRT timestamps, managing state between scroll/timed modes, and updating the subtitle display based on the video's current time.
*   `js/config/gt2.json`: The course configuration file. We will update the first lesson's `simpleVideoUrl` question to include the new SRT formatted subtitles as an example.

## Existing Files to be Called (Not Edited)
*   `js/modules/video-loader.web.js`: This module instantiates `simpleVideoPlayer` and passes the localized subtitle string via the config object. It will remain unchanged as it already passes the string correctly.
*   `js/app.js` or other entry points that trigger the video loader.

## Changes to `js/components/simple-video-player.js`

### 1. New State Variables in `constructor(config)`
Add new properties to track the subtitle mode and parsed data:
```javascript
this.isTimedSubtitles = false;
this.timedSubtitles = []; // Array of objects: { start: number, end: number, text: string }
this.currentSubtitleIndex = -1;
```

### 2. New Method: `parseSubtitles(subtitlesText)`
This method will analyze the subtitle string.
*   Check if the string contains the SRT time separator `-->`.
*   If it does not, return `null`.
*   If it does, split the string into blocks (separated by double newlines).
*   For each block, extract the start/end times and the text.
*   Convert the timestamp format (`HH:MM:SS,ms`) into seconds.
*   Return an array of parsed subtitle objects.

```javascript
parseSubtitles(text) {
  if (!text || typeof text !== 'string') return null;
  if (!text.includes('-->')) return null;

  const blocks = text.trim().split(/\n\s*\n/);
  const parsed = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    // Basic validation to ensure it looks like an SRT block
    let timeLineIndex = lines.findIndex(line => line.includes('-->'));
    if (timeLineIndex === -1) continue;

    const timeString = lines[timeLineIndex];
    const textLines = lines.slice(timeLineIndex + 1).join('<br>');

    const [startStr, endStr] = timeString.split('-->').map(s => s.trim());

    const start = this.timeToSeconds(startStr);
    const end = this.timeToSeconds(endStr);

    if (!isNaN(start) && !isNaN(end)) {
        parsed.push({ start, end, text: textLines });
    }
  }

  return parsed.length > 0 ? parsed : null;
}
```

### 3. New Method: `timeToSeconds(timeStr)`
Helper function to convert an SRT timestamp to seconds.
```javascript
timeToSeconds(timeStr) {
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

### 4. Modified Method: `initSubtitles()`
Update to set the mode and initial display based on the parsing result. Note the switch to `.innerHTML` to support translations with spans, per repository guidelines.

```javascript
// ... existing initSubtitles setup ...

const parsed = this.parseSubtitles(this.config.subtitles);

if (parsed) {
  this.isTimedSubtitles = true;
  this.timedSubtitles = parsed;
  this.subtitleDisplay.innerHTML = ''; // Start empty
  this.subtitleScrollContainer.classList.add('timed-subtitles-container');
  this.subtitleDisplay.classList.add('timed-subtitles');
} else {
  this.isTimedSubtitles = false;
  this.subtitleDisplay.innerHTML = this.config.subtitles;
}

// ... rest of initSubtitles ...
```

Note: The specific styles for `timed-subtitles-container` (e.g., `overflow: hidden;`) and `timed-subtitles` (e.g., `position: absolute; bottom: 10%; width: 100%; text-align: center; transform: translateY(0);`) should be added to the project's main `style.css` file to adhere to the strict separation of concerns and avoid inline styles.

### 5. Modified Method: `updateSubtitleScroll(forceUpdate = false)`
Update the timeupdate listener logic to handle both modes.

```javascript
updateSubtitleScroll(forceUpdate = false) {
  if (this.isTimedSubtitles) {
      this.updateTimedSubtitles();
      return;
  }

  // ... existing scroll logic remains untouched ...
}
```

### 6. New Method: `updateTimedSubtitles()`
Handles displaying the correct text based on `video.currentTime`.

```javascript
updateTimedSubtitles() {
  if (!this.video || this.timedSubtitles.length === 0) return;

  const currentTime = this.video.currentTime;
  let foundIndex = -1;

  for (let i = 0; i < this.timedSubtitles.length; i++) {
    const sub = this.timedSubtitles[i];
    if (currentTime >= sub.start && currentTime <= sub.end) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex !== this.currentSubtitleIndex) {
    this.currentSubtitleIndex = foundIndex;
    if (foundIndex !== -1) {
      this.subtitleDisplay.innerHTML = this.timedSubtitles[foundIndex].text;
    } else {
      this.subtitleDisplay.innerHTML = '';
    }
  }
}
```

## Update Example in `js/config/gt2.json`
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
