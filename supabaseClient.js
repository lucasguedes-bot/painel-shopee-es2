import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://qgjdzrroqvrxteeckazr.supabase.co';

const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnamR6cnJvcXZyeHRlZWNrYXpyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Nzg0NjkxNywiZXhwIjoyMTAzNDIyOTE3fQ.U-pgfYabsJe_4bAnpZiSaphIfqeFjZGByvjsnlA8diY';

if (!supabaseAnonKey) {
  throw new Error(
    'VITE_SUPABASE_ANON_KEY não foi configurada no arquivo .env'
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);