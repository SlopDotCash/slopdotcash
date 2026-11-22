-- A website sign-in flow is bound to the browser that started it. Only the
-- SHA-256 of the random binding secret is stored; the secret itself lives in
-- that browser's HttpOnly cookie on the identity origin. Terminal (CLI) and
-- local development flows keep a null binding.
ALTER TABLE identity_oauth_flows ADD COLUMN browser_binding_hash TEXT
  CHECK (browser_binding_hash IS NULL OR length(browser_binding_hash) = 64);
