# RV Supabase setup

RV uses Supabase Auth and Postgres to save signed-in hosts' active seasons, archives, and shared point systems. Season data is private to its owner. Signed-in users can read shared point systems; only their creator can update or delete them.

## 1. Configure the Supabase project

1. In the Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql).
2. In **Project Settings → API**, copy the Project URL and the publishable key (or legacy `anon` key) into [`supabase-config.js`](./supabase-config.js):

   ```js
   window.RV_SUPABASE_CONFIG = {
     url: "https://YOUR_PROJECT.supabase.co",
     publishableKey: "YOUR_PUBLIC_PUBLISHABLE_KEY",
     siteUrl: "https://YOUR_GITHUB_NAME.github.io/YOUR_REPOSITORY/",
   };
   ```

3. In **Authentication → URL Configuration**, set the Site URL to the same GitHub Pages address and add it to the Redirect URLs allowlist. Keep the trailing slash consistent.
4. In **Authentication → Providers → Email**, enable email/password sign-in. To allow immediate sign-in after signup, disable email confirmations. With confirmations enabled, new accounts must confirm their email first. Supabase also controls whether email changes require confirmation.
5. Install the Supabase CLI, link this folder to the same project, then deploy the username-login function:

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy username-login
   ```

   The function resolves usernames to email addresses using a database function callable only by the service role, then lets Supabase Auth validate the password. Configure Supabase Auth rate limits for password sign-ins as appropriate. Never expose or add a service-role key to browser files.
6. Publish the contents of this folder to the configured GitHub Pages repository. Open the deployed `index.html` over HTTPS to test account creation.

The URL and publishable/anon key are public browser configuration and are restricted by row-level security. Never place a Supabase service-role or secret key in browser files or GitHub Pages.

## 2. Account and saved data behavior

- Anyone may sign up with an email, password, and unique public username. Whether confirmation is needed before sign-in depends on the project's email-confirmation setting.
- Signed-in users can change their username, email, and password from **Account**. Username changes update the Supabase Auth metadata and host profile together. Email changes may remain pending until the confirmation step configured by Supabase is completed.
- Sign in accepts either the account email or public username. Username sign-in requires the deployed `username-login` Edge Function.
- Forgot-password emails return to the configured site URL. After opening the reset link, choose a new password in the RV dialog.
- The active season and saved season history are loaded for the signed-in account and saved after season creation and every event.
- Point systems are shared among signed-in accounts and have globally unique names. Their creator username is shown, and only the creator may change their saved system. Use a different name to publish a modified copy.
- Signing out clears the in-memory account data from the app view. Signing back in reloads it from Supabase.
- Season image backgrounds upload to the private `rv-season-backgrounds` Storage bucket under the owner's UUID. The app refreshes owner-scoped signed URLs as needed; season rows keep the storage path, not the base64 image content.

## 3. Optional host permissions for the shared participant catalog

The existing `rv_users`, `rv_colors`, and `rv_user_colors` tables remain a separate, curated catalog. To permit an account to manage that catalog or upload its existing shared backgrounds, add its UUID to `rv_hosts` in the SQL Editor:

```sql
insert into public.rv_hosts (user_id)
values ('HOST_AUTH_USER_UUID');
```

Do not grant this role unless the account should manage the shared participant/color catalog. It is not required to create seasons, point systems, or upload its own season backgrounds.
