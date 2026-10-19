// Reserved share-code words. These are never *minted* by the server
// (supabase/migrations/010_short_share_codes.sql) or the client fallback, so
// new accounts never get a code that reads as an offensive or confusing word.
// The route gate deliberately stays shape-only: a legacy code that happens to
// be one of these words still resolves to its profile. Kept in lock-step with
// the SQL seed list by the guard in src/modules/utils/short-id.test.js.
export const RESERVED_SHARE_CODES = new Set([
    'about', 'admin', 'asses', 'assho', 'beanr', 'bitch', 'boche', 'cocks',
    'codes', 'cunts', 'dicks', 'dykes', 'error', 'fagot', 'fatty', 'freak',
    'fucks', 'guest', 'guido', 'hoess', 'idiot', 'media', 'moron', 'nigga',
    'penis', 'press', 'prick', 'pussy', 'queer', 'reset', 'retar', 'scumb',
    'share', 'skank', 'spick', 'teams', 'token', 'trash', 'twats', 'users',
    'voids', 'wetbk', 'whore',
]);
