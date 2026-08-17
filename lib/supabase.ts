import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG } from '@/constants/config';

let _supabase: SupabaseClient | null = null;
if (SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey) {
  _supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
}
export const supabase = _supabase;
