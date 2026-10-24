// Supabase configuration template for local setup.
// Do not commit real secrets into source control.
// Fill in values only after creating a real Supabase project.

window.FRAMEFLOW_SUPABASE_CONFIG = {
  enabled: false,
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  FACTORY_ID: '' // Optional when the signed-in Auth user has factory memberships.
};

// To enable Supabase mode later, provide actual values and set:
// window.FRAMEFLOW_SUPABASE_CONFIG = {
//   enabled: true,
//   SUPABASE_URL: 'YOUR_SUPABASE_PROJECT_URL',
//   SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
//   FACTORY_ID: 'YOUR_FACTORY_UUID' // Optional when memberships are discovered after sign-in.
// };
