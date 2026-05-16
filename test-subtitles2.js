const Controller = require('./js/modules/simple-video-controller.js').SimpleVideoStateController;

// Mock the controller to test state changes
const ctrl = new Controller();

let lastState = null;
ctrl.subscribe(state => {
    lastState = state;
    console.log("State updated: activeSubtitleText=", state.activeSubtitleText, "isTimed=", state.isTimedSubtitles);
});

const text = `1\n00:00:00,500 --> 00:00:03,000\nVamos a hacer un role play de pedir una bebida.\n\n2\n00:00:03,500 --> 00:00:06,000\nTú serás el cliente y yo te venderé la bebida.\n\n3\n00:00:06,500 --> 00:00:10,000\nPrimero vamos a calentar nuestros micrófonos y nuestras bocas. Di: I LOVE ENGLISH!`;

console.log("Initializing...");
ctrl.initSubtitles(text);

console.log("Updating progress to 0.0...");
ctrl.updateProgress(0.0, 10.0);
console.log("Updating progress to 1.0...");
ctrl.updateProgress(1.0, 10.0);
console.log("Updating progress to 3.2...");
ctrl.updateProgress(3.2, 10.0);
console.log("Updating progress to 4.0...");
ctrl.updateProgress(4.0, 10.0);
