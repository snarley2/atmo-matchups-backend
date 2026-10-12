// Retained command path for compatibility with existing cron jobs.
// Collection now writes Supabase directly; copying old Sheets data would undo it.
console.log("[sync] No copy needed: WorkMyT collectors now write directly to Supabase. Run npm run run to refresh performance.");
