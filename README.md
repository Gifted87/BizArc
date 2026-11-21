# BizArc

BizArc is an experimental corporate treasury and financial operations platform built with TypeScript, PostgreSQL, Solidity, and Circle wallet integrations. The codebase brings together treasury policy and account services, liability and payment workflows, ledger and audit components, an HTTP API, and smart contract examples for Arc L1.

This repository is an active prototype. Integrations, contracts, and operational workflows require configuration and validation for the target environment. Do not use it to manage production funds without an independent security review.

## What is in the repository

- `src/` — TypeScript services, agents, orchestration state machines, database access, payment rails, and the HTTP ingress layer.
- `contracts/` — Solidity treasury and disbursal vault contracts.
- `database/` — PostgreSQL schema and SQL migrations.
- `config/` — business policy and network configuration examples.
- `scripts/` — server startup, contract compilation and deployment, and account or vendor setup utilities.
- `tests/` — feature and integration test scripts.
- `frontend/` — a separate Vite application with its own dependencies and setup instructions.
- `docs/` — architecture, API, onboarding, payment, security, and ledger documentation. See [the documentation index](docs/README.md).

## Requirements

- Node.js and npm
- PostgreSQL for database-backed workflows
- Arc RPC access and Circle credentials for the corresponding wallet or on-chain integrations

Some capabilities need external services and contract addresses. You can explore the code and compile the contracts without connecting a live wallet, but deployment and transaction flows need a correctly configured environment.

## Backend setup

From the repository root:

```bash
npm install
cp .env.example .env
```

Edit `.env` with values for the services you intend to use. Keep credentials in `.env`; do not commit them. The example file documents configuration keys for Arc, Circle, PostgreSQL, policy selection, contract addresses, and the admin approver.

Apply the database schema and start the HTTP server:

```bash
npm run migrate
npx tsx scripts/startServer.ts
```

The server listens on port `3000` by default. `npx tsx scripts/startServer.ts` starts the API process; it does not deploy contracts or provision production infrastructure.

To compile the Solidity contracts and generate their local artifacts:

```bash
npm run compile
```

To run the TypeScript build:

```bash
npm run build
```

The repository also defines focused test scripts and a combined `npm test` command. Several tests exercise configured integrations, so review their setup and environment requirements before running them.

## Frontend

The frontend is maintained as a separate npm application. Follow its [README](frontend/README.md) for local setup and required API key configuration.

## Configuration and security

- Use dedicated development wallets and test networks while evaluating integrations.
- Store API keys, entity secrets, database credentials, and signing material outside version control.
- Review policy limits, contract addresses, authorization paths, and transaction behavior before enabling any live operation.
- Treat the documentation as a description of the intended system design; verify implementation status and behavior in code before relying on a capability.

## License

The package metadata currently declares the ISC license. See `package.json` and confirm the licensing terms before redistributing the project.
