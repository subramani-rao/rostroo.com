# Rostroo.com premium acquisition site

## Publish with GitHub Pages
1. Create a repository such as `rostroo-com`.
2. Upload the contents of this folder to the repository root.
3. Open **Settings → Pages**.
4. Choose **Deploy from a branch**, select `main`, and choose `/ (root)`.
5. Add `rostroo.com` as the custom domain and enable HTTPS when available.

## IONOS DNS
Create four A records for the root domain:
- 185.199.108.153
- 185.199.109.153
- 185.199.110.153
- 185.199.111.153

Create a CNAME for `www` pointing to `<your-github-username>.github.io`.

## Contact destination
The enquiry form opens an email to `suburao909@gmail.com`. Edit the `recipient` value in `index.html` to change it.
