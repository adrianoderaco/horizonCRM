// Arquivo: js/supabase.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { CONFIG } from './config.js';

// Cria e exporta a instância única do Supabase
export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);