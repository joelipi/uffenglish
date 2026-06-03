import { evaluate, LinguisticEngine } from './engine.js';

const mockWordNetGraph = {
  "n07917524": {
    "w": ["food", "meal"],
    "h": ["n01"]
  },
  "n01": {
    "w": ["pizza", "salad"],
    "h": []
  }
};

const mockGrammaticalPack = {
  "id": "request_stems_casual_v1",
  "register": "casual",
  "valid_request_stems": [
    {
      "phrase": "i'd like",
      "register": "neutral",
      "feedback": null
    },
    {
      "phrase": "can i get",
      "register": "casual",
      "feedback": null
    },
    {
      "phrase": "may i have",
      "register": "formal",
      "feedback": "This is a little formal for this setting but perfectly polite."
    }
  ],
  "forbidden_frames": [
    {
      "phrase": "i demand",
      "severity": "error",
      "feedback": "This is far too forceful and rude for this situation."
    },
    {
      "phrase": "give me",
      "severity": "warning",
      "feedback": "This is too direct for this setting. Try 'could I have' or 'I'd like' instead."
    }
  ]
};

const mockEstablishmentPack = {
  "id": "applebees_v1",
  "target_synset": "n07917524",
  "modifier_constraints": {
    "soup": {
      "countability": "uncount",
      "allowed_modifiers": ["tomato", "chicken", "broccoli", "french onion", "spicy", "hot"],
      "count_shift_modifiers": ["tomato", "chicken", "broccoli", "french onion"]
    },
    "burger": {
      "countability": "count_sing",
      "allowed_modifiers": ["cheese", "double", "bacon", "spicy", "classic"],
      "count_shift_modifiers": []
    }
  },
  "modifiers": {
    "spicy":        { "type": "quality" },
    "double":       { "type": "quantity" },
    "french onion": { "type": "lexical" },
    "hot": { "type": "quality" },
    "tomato": { "type": "lexical" },
    "cheese": { "type": "lexical" }
  }
};

const mockScenarioPack = {
  "id": "applebees_order_drink_cue_01",
  "grammatical_pack_id": "request_stems_casual_v1",
  "establishment_pack_id": "applebees_v1",
  "register": "casual",
  "bare_np_permitted": true,
  "communicative_goal": "order a main course from the server",
  "cue": {
    "student_role": "customer",
    "other_speaker_role": "server",
    "other_speaker_line": "Hi there, what can I get for you today?",
    "setting": "..."
  }
};

const linguisticEngine = new LinguisticEngine(mockWordNetGraph);

const tests = [
  {
    text: "I'd like a spicy tomato soup please",
    desc: "Valid count shift modifier with determiner"
  },
  {
    text: "Can I get a french onion soup",
    desc: "Valid multi-word modifier with determiner"
  },
  {
    text: "May I have a pizza",
    desc: "Valid register-mismatched frame, WordNet vocab"
  },
  {
    text: "I demand a spicy burger",
    desc: "Forbidden frame error"
  },
  {
    text: "Give me some soup",
    desc: "Forbidden frame warning, valid uncountable"
  },
  {
    text: "I'd like a soup",
    desc: "Grammar error: determiner with uncountable"
  },
  {
    text: "I'd like burger",
    desc: "Grammar error: missing determiner for count_sing"
  },
  {
    text: "I'd like a spicy cheese burger and a hot soup",
    desc: "Wait, 'hot soup' is allowed, 'spicy cheese burger' is allowed. hot is not count_shift_modifier, soup is uncountable, so 'a hot soup' is grammar error."
  },
  {
    text: "I'd like a spicy double burger",
    desc: "Two modifiers for burger"
  },
  {
    text: "I'd like a spicy shoe",
    desc: "Lexical error: shoe not valid in scenario"
  }
];

let allPassed = true;
tests.forEach((t, i) => {
  const result = evaluate({ text: t.text }, mockScenarioPack, mockGrammaticalPack, mockEstablishmentPack, linguisticEngine);
  if (!result) allPassed = false;
});

if (allPassed) {
  console.log("All tests executed successfully!");
} else {
  console.error("Some tests failed.");
  process.exit(1);
}
