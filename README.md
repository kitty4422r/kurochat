# Chat Archive on a private Cloudflare R2 bucket

Your files live in a private R2 bucket (nothing public, nothing encrypted). A small Cloudflare
Worker sits in front of it: it asks for a password, then serves `index.html`, your export `.json`,
and the media folder straight from the bucket.

Files here:
- `index.html`  - the viewer (goes in the bucket)
- `worker.js`   - the password-gated server (deployed to Cloudflare)
- `wrangler.toml` - Worker settings (edit the bucket name)

## 1. Create the bucket

Cloudflare dashboard -> R2 Object Storage -> **Create bucket**. Name it e.g. `chat-archive`,
Location "Automatic", Standard storage. Leave public access OFF (the default).

## 2. Upload your files (rclone, since the export is big)

Everything goes in the **top level** of the bucket: `index.html`, the export `.json`, and its
`..._Files` media folder side by side (exactly how the exporter made them; don't rename them).

1. R2 -> **Manage API tokens** -> Create API token -> permission **Object Read & Write**, scoped to
   your bucket. Copy the Access Key ID and Secret Access Key.
2. Install rclone (rclone.org/install) and run `rclone config` -> new remote named `r2`, type `s3`,
   provider `Cloudflare`, paste the keys, endpoint
   `https://3a2ac1b74905d52c5c9f0e70028d504d.r2.cloudflarestorage.com`.
   (Or put this in rclone.conf:)
   ```
   [r2]
   type = s3
   provider = Cloudflare
   access_key_id = YOUR_KEY_ID
   secret_access_key = YOUR_SECRET
   endpoint = https://3a2ac1b74905d52c5c9f0e70028d504d.r2.cloudflarestorage.com
   acl = private
   no_check_bucket = true
   ```
3. Upload:
   ```
   rclone copy "C:\path\to\your export folder" r2:chat-archive --progress
   rclone copy index.html r2:chat-archive
   ```
   Rerun the same commands any time to add new messages (it only uploads what changed).

(`wrangler r2 object put` also works but handles one file at a time, up to ~315 MB.)

## 3. Deploy the Worker with the password

You need Node.js installed. In the folder with `worker.js` and `wrangler.toml`:

1. Open `wrangler.toml` and set `bucket_name` to your bucket's exact name.
2. `npx wrangler login`  (opens the browser to approve)
3. `npx wrangler deploy`  (prints your URL, like `https://chat-archive.<you>.workers.dev`)
4. `npx wrangler secret put SITE_PASSWORD`  (type the password when asked)

Until step 4 the site just says "Not configured yet", so it's never open by accident.

## 4. Use it

Open the URL. The browser shows a login box: type anything as the username, and the password as
the password. The browser remembers it for the session. Send him the link and the password
separately.

## Notes

- The login is the browser's built-in password box, so it isn't pretty, but it works for images and
  video too. There's no lockout after wrong guesses, so use a long password (16+ characters).
- Prefer email-code login instead of a shared password? Turn on Cloudflare Access for the Worker
  in the dashboard (Workers & Pages -> your Worker -> Access), choose the allowed emails, and add a
  plain variable `ACCESS_ONLY` = `1` to the Worker instead of the `SITE_PASSWORD` secret.
- To change the password: run step 4 again.
- Pricing: R2 and Workers both have free tiers, but check current limits at cloudflare.com/pricing
  before uploading a very large media folder.
