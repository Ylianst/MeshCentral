# Web server modules

`webserver.js` is the composition root for the web server. The modules in this
directory are grouped by responsibility:

- `agents`: agent downloads, configuration, routing and operations.
- `auth/account`: account creation, recovery and account-related email flows.
- `auth/login`: local login, passwords, sessions and second-factor flows.
- `auth/sso`: external identity providers and SSO account synchronization.
- `bootstrap`: initial state, startup data and server lifecycle.
- `domains`: domain-specific initialization, assets and features.
- `files`: storage, uploads, downloads and recordings.
- `http/middleware`: request processing and HTTP security policy.
- `http/routes`: Express route-family construction and registration.
- `realtime`: WebSockets, relays, tunnels, messaging and subscriptions.
- `services`: independent operational services.
- `shared`: cross-cutting utilities used by multiple areas.
- `ui`: page rendering and browser-facing application state.

Place a new module in the narrowest matching area. Keep cross-area dependencies
explicit and wire services together in `webserver.js`; avoid using `shared` as a
default location for modules that have a clear domain owner.
