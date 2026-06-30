-- Phase 7b: JIRA authenticates via OAuth 2.0 (3LO). The access/refresh tokens
-- now live in oauth_connection(provider='jira'); jira_site only needs the cloud
-- id (added here) alongside the site URL, developer field, and project links.
-- The legacy email/encrypted_token/token_nonce columns are left in place
-- (jira_site is a FK parent of jira_project, so an in-place ADD avoids a rebuild)
-- but are no longer used — the repository writes empty strings to them.
ALTER TABLE jira_site ADD COLUMN cloud_id TEXT;
