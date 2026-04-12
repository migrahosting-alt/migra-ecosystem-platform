## Workspace E2E

The Playwright suites exercise the in-app workspaces like an operator.

### MigraMarket coverage

- sign in
- assign a package
- update the client profile
- create, edit, publish, and delete intake forms
- create and update leads
- create, update, and delete report snapshots
- create, update, and delete locations
- create, update, and delete tasks

### MigraDrive coverage

- sign in and open `/app/drive`
- verify tenant bootstrap state renders
- verify seeded file rows render
- upload a file through the existing init/upload/finalize flow
- issue a signed download URL
- issue a share link
- cancel a pending upload
- verify restricted, disabled, pending, and empty-state UI handling

### Requirements

Provide one of these before running the suite:

- a working container runtime so Testcontainers can start Postgres automatically
- `DATABASE_URL_TEST` pointing to a disposable Postgres database

### Commands

Install browsers if needed:

```bash
npx playwright install chromium
```

List tests:

```bash
npx playwright test --list
```

Run the full browser flow:

```bash
npm run test:e2e
```

Run only the MigraDrive browser flow:

```bash
npm run test:e2e:migradrive
```

### Notes

- The Playwright global setup seeds one owner account and org with both MigraMarket and MigraDrive enabled.
- The seeded login is injected automatically through environment variables inside the setup.
- If setup fails before the browser opens, confirm Docker/Testcontainers works or that `DATABASE_URL_TEST` is valid.
