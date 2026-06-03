// TODO: Implement with expo-linking
// Contract: useUrlParam(name) hook, getAppOrigin() function
//
// ⚠️ DO NOT import from url-params.js (the router) in native code.
// The router hardcodes web exports. Import from this file directly:
//   import { useUrlParam, getAppOrigin } from './url-params.native.js';
export function useUrlParam(name) {
    // TODO: use useURL() from expo-linking to read deep link params
    return null;
}

export function getAppOrigin() {
    // TODO: use Linking.createURL('/') from expo-linking
    return '';
}
