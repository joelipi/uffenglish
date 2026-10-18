// Reserved share-code words. These are never minted by the server
// (supabase/migrations/010_short_share_codes.sql) and never resolve to a
// profile, so a URL whose segment is one of them renders the 404 page rather
// than "User not found". Kept in lock-step with the SQL seed list by the
// guard in src/modules/utils/short-id.test.js.
export const RESERVED_SHARE_CODES = new Set([
    'about', 'admin', 'asses', 'assho', 'beanr', 'bitch', 'boche', 'cocks',
    'codes', 'cunts', 'dicks', 'dykes', 'error', 'fagot', 'fatty', 'freak',
    'fucks', 'guest', 'guido', 'hoess', 'idiot', 'media', 'moron', 'nigga',
    'penis', 'press', 'prick', 'pussy', 'queer', 'reset', 'retar', 'scumb',
    'share', 'skank', 'spick', 'teams', 'token', 'trash', 'twats', 'users',
    'voids', 'wetbk', 'whore',
]);
