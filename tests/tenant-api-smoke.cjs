// Read-only PostgREST relationship smoke checks. No customer rows are requested.
// Supply a public key via REJOYCE_PUBLIC_KEY; never use a service-role key.
const checks = [
  ['sessions', 'id,clients(first_name,preferred_name),provider:users!sessions_provider_id_fkey(full_name,email),session_targets(id)'],
  ['session_notes', 'id,sessions(id,clients(first_name,last_name,preferred_name),provider:users!sessions_provider_id_fkey(full_name,email))'],
  ['tasks', 'id,classrooms(name),children(name)'],
  ['session_targets', 'id,sessions(id),client_targets(id)'],
  ['behavior_events', 'id,sessions(id),client_behaviors(id)'],
  ['target_responses', 'id,sessions(id),session_targets(id)'],
  ['task_completions', 'id,tasks(id),users(id)'],
  ['task_templates', 'id,classrooms(id),children(id),users(id)'],
];
(async () => {
  const key = process.env.REJOYCE_PUBLIC_KEY;
  if (!key || !key.startsWith('sb_publishable_')) throw new Error('Use a publishable key in REJOYCE_PUBLIC_KEY');
  for (const [table, select] of checks) {
    const url = new URL('https://lvtabzfkajgicjfexvxx.supabase.co/rest/v1/' + table);
    url.searchParams.set('select', select);
    url.searchParams.set('limit', '0');
    const res = await fetch(url, { headers: { apikey: key }, signal: AbortSignal.timeout(15000) });
    const body = await res.json();
    if (!res.ok || !Array.isArray(body) || body.length) {
      console.error(table, res.status, body.code, body.message);
      process.exitCode = 1;
    } else console.log('PASS:', table, 'relationship resolution (zero records)');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
