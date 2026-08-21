// ————————————————————————————————————————————————————————————
// Single shared Supabase client for the whole app (auth, matching,
// analytics, summaries). One client, one config source.
// ————————————————————————————————————————————————————————————

import { createClient } from '@supabase/supabase-js'

// Project URL + publishable key (Dashboard → Project Settings → API).
// Safe to ship in the client.
export const SUPABASE_URL = 'https://aazquqwcfpbnoouinmhn.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_8-zmag01KDM6IeJW7DWqJw_VOU8p6oy'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
