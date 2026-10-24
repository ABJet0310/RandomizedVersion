# RV Supabase setup

RV uses Supabase Auth and Postgres to save signed-in hosts' active seasons, archives, and shared point systems. Season data is private to its owner. Signed-in users can read shared point systems; only their creator can update or delete them.

## 1. Configure the Supabase project

1. In the Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql). If the schema was already applied, run the updated file again to install the profile-name synchronization trigger.
2. In **Project Settings → API**, copy the Project URL and the publishable key (or legacy `anon` key) into [`supabase-config.js`](./supabase-config.js):

   ```js
   window.RV_SUPABASE_CONFIG = {
     url: "https://YOUR_PROJECT.supabase.co",
     publishableKey: "YOUR_PUBLIC_PUBLISHABLE_KEY",
     siteUrl: "https://YOUR_GITHUB_NAME.github.io/YOUR_REPOSITORY/",
   };
   ```

3. In **Authentication → URL Configuration**, set the Site URL to the same GitHub Pages address and add it to the Redirect URLs allowlist. Keep the trailing slash consistent.
4. In **Authentication → Hooks**, make sure no **Send Email Hook** is enabled. In **Authentication → Sign In / Providers → Email**, enable email/password sign-in and turn **Confirm email** off. New users will be signed in immediately after signup without sending an email. No email hook, SMTP provider, or SQL function is needed. Supabase's built-in mailer is limited to addresses belonging to your Supabase organization and is not suitable for public signup confirmation.
5. Publish the contents of this folder to the configured GitHub Pages repository. Open the deployed `index.html` over HTTPS to test account creation.

The URL and publishable/anon key are public browser configuration and are restricted by row-level security. Never place a Supabase service-role or secret key in browser files or GitHub Pages.

## 2. Account and saved data behavior

- Anyone may sign up with an email, password, and unique public username. With **Confirm email** turned off, signup immediately signs the user in without sending a confirmation email.
- Password-reset links still require email delivery. Without an email provider, users who forget their password may be unable to recover their account. Signed-in users can change their password in Account settings by entering their current password.
- If **Confirm email** remains on, users must receive and open a confirmation email before they can sign in; Supabase's built-in mailer is only suitable for testing with organization-member email addresses.
- Signed-in users can open the profile dropdown to sign out or manage their public username, email address, and password. Changing an email may require confirmation depending on the Auth email-confirmation settings. Password and email changes ask the user to re-enter their current password.
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
