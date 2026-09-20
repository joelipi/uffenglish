// src/modules/api/supabase-constants.js
// Publishable Supabase project defaults shared by the SPA client
// (src/modules/api/supabase.js) and the Pages Function
// (functions/api/upload-segment.js). The anon key is public by design — it
// ships in the client bundle — so these fallbacks let both consumers verify
// JWTs even when env vars are not set. No import.meta.env here: this module
// must stay safe in the Pages Functions bundle.
export const DEFAULT_SUPABASE_URL = 'https://jbrbmbmupjfangqvaevx.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_xd9bYag0bVG7m74CemthjQ_sJEbQG9S';