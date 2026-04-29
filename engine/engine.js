function normalize(text) {
  return text
    .toLowerCase()
    .replace(/\b(uh|um|er)\b/g, "")
    .replace(/\b(gonna)\b/g, "going to")
    .replace(/\b(wanna)\b/g, "want to")
    .replace(/[,?!.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return text.split(/\s+/).map((t, i) => ({
    token: t,
    index: i
  }));
}

function extractRequestFrame(normalizedText, grammaticalPack) {
  const stems = grammaticalPack.valid_request_stems
    .map(s => s.phrase)
    .sort((a, b) => b.length - a.length);

  for (const stem of stems) {
    if (normalizedText.startsWith(stem)) {
      return stem;
    }
  }
  return null;
}

function validateRequestFrame(normalizedText, frame, scenarioPack, grammaticalPack) {
  const errors = [];

  for (const forbidden of grammaticalPack.forbidden_frames) {
    if (normalizedText.includes(forbidden.phrase)) {
      errors.push({
        type: "PRAGMATICS",
        severity: forbidden.severity,
        message: forbidden.phrase + ' is not appropriate here',
        feedback: forbidden.feedback
      });
    }
  }

  if (!frame && !scenarioPack.bare_np_permitted) {
    errors.push({
      type: "FRAME",
      severity: "error",
      message: "Response must begin with a polite request form",
      feedback: "Try starting with 'I'd like' or 'Could I have'."
    });
  }

  if (frame) {
    const stemData = grammaticalPack.valid_request_stems
      .find(s => s.phrase === frame);

    if (stemData && stemData.register !== scenarioPack.register && stemData.feedback) {
      errors.push({
        type: "PRAGMATICS",
        severity: "warning",
        message: frame + ' is register-mismatched for this scenario',
        feedback: stemData.feedback
      });
    }
  }

  return errors;
}

function extractPhrases(tokens, establishmentPack, wordNetVocab) {
  const phrases = [];

  const knownModifiers = new Set();
  const constraints = establishmentPack.modifier_constraints || {};
  for (const noun in constraints) {
    constraints[noun].allowed_modifiers.forEach(mod => knownModifiers.add(mod));
  }

  const determiners = new Set(["a", "an", "the", "some", "any", "this", "that"]);

  let i = tokens.length - 1;

  while (i >= 0) {
    const tokenStr = tokens[i].token;

    if (constraints[tokenStr] || wordNetVocab.has(tokenStr)) {
      const noun = tokenStr;
      const endIndex = i;
      const modifiers = [];
      let det = null;
      let j = i - 1;

      while (j >= 0) {
        const prevTokenStr = tokens[j].token;

        let multiWordMatch = false;
        if (j > 0) {
          const combined = tokens[j-1].token + " " + prevTokenStr;
          if (knownModifiers.has(combined)) {
            modifiers.unshift(combined);
            j -= 2;
            multiWordMatch = true;
            continue;
          }
        }

        if (!multiWordMatch) {
          if (knownModifiers.has(prevTokenStr)) {
            modifiers.unshift(prevTokenStr);
            j--;
          } else if (determiners.has(prevTokenStr)) {
            det = prevTokenStr;
            j--;
            break;
          } else {
            break;
          }
        }
      }

      phrases.unshift({
        det: det,
        modifiers: modifiers,
        noun: noun,
        start: j + 1,
        end: endIndex
      });

      i = j;
    } else {
      i--;
    }
  }

  return phrases;
}

class LinguisticEngine {
  constructor(wordNetGraph) {
    this.graph = wordNetGraph;
  }

  getVocabulary(rootId) {
    const validWords = new Set();
    const queue = [rootId];

    while (queue.length > 0) {
      const currentId = queue.shift();
      const node = this.graph[currentId];

      if (node) {
        node.w.forEach(word => validWords.add(word.toLowerCase()));
        if (node.h) queue.push(...node.h);
      }
    }
    return validWords;
  }
}

function checkLexicalCompatibility(np, establishmentPack) {
  const nounData = establishmentPack.modifier_constraints[np.noun];
  const errors = [];

  for (const mod of np.modifiers) {
    if (!nounData.allowed_modifiers.includes(mod)) {
      errors.push({
        type: "LEXICAL",
        severity: "error",
        message: mod + ' cannot modify ' + np.noun + ' in this context',
        feedback: mod + ' ' + np.noun + ' is not a natural combination here.'
      });
    }
  }

  return errors;
}

function evaluateGrammar(np, nounData) {
  const errors = [];

  let effective = nounData.countability;
  if (
    nounData.countability === "uncount" &&
    np.modifiers.some(m => nounData.count_shift_modifiers.includes(m))
  ) {
    effective = "count_sing";
  }

  if (effective === "count_sing" && !np.det) {
    errors.push({
      type: "GRAMMAR",
      severity: "error",
      message: "Missing determiner before " + np.noun,
      feedback: "Use 'a' or 'an' before " + np.noun + "."
    });
  }

  if (effective === "count_plur" && ["a", "an"].includes(np.det)) {
    errors.push({
      type: "GRAMMAR",
      severity: "error",
      message: np.det + " cannot be used with plural " + np.noun,
      feedback: "Remove " + np.det + " — plural nouns don't take 'a' or 'an'."
    });
  }

  if (effective === "uncount" && ["a", "an"].includes(np.det)) {
    errors.push({
      type: "GRAMMAR",
      severity: "error",
      message: np.det + " cannot be used with uncountable " + np.noun,
      feedback: np.noun + " is uncountable here — remove " + np.det + "."
    });
  }

  return errors;
}

function computeScores(errors) {
  let grammar    = 100;
  let lexical    = 100;
  let pragmatics = 100;

  for (const e of errors) {
    if (e.type === "GRAMMAR")    grammar    -= e.severity === "error" ? 20 : 10;
    if (e.type === "LEXICAL")    lexical    -= e.severity === "error" ? 25 : 10;
    if (e.type === "PRAGMATICS") pragmatics -= e.severity === "error" ? 30 : 15;
    if (e.type === "FRAME")      pragmatics -= e.severity === "error" ? 30 : 15;
  }

  return {
    grammar:    Math.max(0, grammar),
    lexical:    Math.max(0, lexical),
    pragmatics: Math.max(0, pragmatics)
  };
}

function formatOutput(errors, scores) {
  let overall = "pass";
  if (errors.some(e => e.severity === "error")) {
    overall = "fail";
  } else if (errors.some(e => e.severity === "warning")) {
    overall = "warning";
  }

  return {
    overall: overall,
    scores: scores,
    errors: errors
  };
}

function evaluate(input, scenarioPack, grammaticalPack, establishmentPack, linguisticEngine) {
  const normalized = normalize(input.text);
  const tokens = tokenize(normalized);
  const frame = extractRequestFrame(normalized, grammaticalPack);
  const wordNetVocab = linguisticEngine.getVocabulary(establishmentPack.target_synset);
  const phrases = extractPhrases(tokens, establishmentPack, wordNetVocab);

  const errors = [];

  errors.push(...validateRequestFrame(normalized, frame, scenarioPack, grammaticalPack));

  for (const np of phrases) {
    const nounData = establishmentPack.modifier_constraints[np.noun];

    if (nounData) {
      errors.push(...checkLexicalCompatibility(np, establishmentPack));
      errors.push(...evaluateGrammar(np, nounData));
    } else if (wordNetVocab.has(np.noun)) {
      // Noun valid via WordNet — no modifier or grammar checks
    } else {
      errors.push({
        type: "LEXICAL",
        severity: "error",
        message: np.noun + " is not valid in this scenario",
        feedback: np.noun + " is not something you can order here."
      });
    }
  }

  const scores = computeScores(errors);
  return formatOutput(errors, scores);
}

export {
  normalize,
  tokenize,
  extractRequestFrame,
  validateRequestFrame,
  extractPhrases,
  LinguisticEngine,
  checkLexicalCompatibility,
  evaluateGrammar,
  computeScores,
  formatOutput,
  evaluate
};
