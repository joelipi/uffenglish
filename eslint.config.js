// Flat ESLint config (ESLint 10 is flat-config-only).
//
// Migrated faithfully from the legacy `.eslintrc.json`, which targeted
// `js/**/*.{js,jsx}` (excluding `*-webonly.*`) and warned when browser-only
// globals `window`/`document` were used without a `*-webonly` filename or a
// `typeof ... !== "undefined"` guard. The source tree moved from `js/` to
// `src/`, so the same rule now applies to `src/**/*.{js,jsx}`.
//
// `react-hooks` is registered (rule left off) solely so the repo's existing
// `eslint-disable(-line|-next-line) react-hooks/exhaustive-deps` directives
// resolve, including in the `*-webonly.*` files that the browser-only rule
// excludes. The legacy config never enabled the rule, so neither do we;
// without registering the plugin ESLint 10 reports "Definition for rule ...
// was not found" for each directive.
import reactHooks from 'eslint-plugin-react-hooks';

const browserOnlyRestrictedSyntax = [
  'warn',
  {
    selector: "MemberExpression[object.name='window']",
    message:
      "window is browser-only. Either rename file to *-webonly.js, or guard with 'typeof window !== \"undefined\"' and add a comment explaining why.",
  },
  {
    selector: "MemberExpression[object.name='document']",
    message:
      "document is browser-only. Either rename file to *-webonly.js, or guard with 'typeof document !== \"undefined\"' and add a comment explaining why.",
  },
];

export default [
  {
    files: ['src/**/*.js', 'src/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    linterOptions: {
      // The legacy config did not report unused disable directives, and the
      // repo has eight `react-hooks/exhaustive-deps` suppressions the rule was
      // never enabled for. Keep those quiet so this migration adds no findings
      // beyond the browser-only rule.
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // Registered but not enforced (matching the legacy config): the point is
      // to satisfy the existing disable directives, not to add new findings.
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: ['src/**/*.js', 'src/**/*.jsx'],
    ignores: ['**/*-webonly.*'],
    rules: {
      'no-restricted-syntax': browserOnlyRestrictedSyntax,
    },
  },
];
