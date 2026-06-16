# EasySLR — Systematic Literature Review Workspace

EasySLR is an intelligent web application built for researchers to import citation datasets (PMID/DOI exports) and screen articles with role-based access control and high-performance duplicate resolution.

---

## 1. Setup

### Prerequisites
- Node.js (v18+)
- PostgreSQL database instance

### Installation & Database Sync
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables in `.env` (using `.env.example` as a template):
   ```env
   DATABASE_URL="postgresql://username:password@localhost:5432/easyslr"
   AUTH_SECRET="your-auth-jwt-secret-key"
   ```
3. Deploy the database schema:
   ```bash
   npx prisma migrate deploy
   ```
4. Seed the database with the initial demo credentials:
   ```bash
   npm run db:seed
   ```
5. Start the application server:
   ```bash
   npm run dev
   ```

---

## 2. Demo Credentials & Local SMTP Setup

To evaluate the application locally using the seeded demo accounts, you will use the normal authentication flow with a local mail catcher (such as **Maildev** or **Mailpit**) to receive the passwordless magic links.

### Zero-Config Mail Catcher Setup
The application is pre-configured to connect to a local SMTP server on port `1025` (`smtp://localhost:1025`).

1. In a new terminal window, start a mail catcher using `npx`:
   ```bash
   npx maildev
   ```
   *Note: This starts an SMTP server on port `1025` and a web dashboard on `http://localhost:1080`.*

2. Access the seeded accounts:
   * **Organization Owner**: `owner@easyslr.test`
   * **Project Manager**: `manager@easyslr.test`
   * **Project Reviewer**: `reviewer@easyslr.test`

3. To sign in:
   * Go to `/auth/signin` in your browser.
   * Enter one of the email addresses above and click **Send Magic Link**.
   * Open the Maildev dashboard at `http://localhost:1080` in your browser.
   * Click the link in the received email to instantly authenticate and access the workspace.

---

## 3. Authentication

EasySLR enforces a secure, production-only authentication flow:
* **Email Magic Links**: Secure, passwordless authentication using one-time verification links sent via SMTP.
* **Google OAuth**: Verified authentication via Google OAuth integration.
* **Owner Registration**: New lab owners register their organization and verify their email via secure activation links before workspaces are created.

---

## 4. Authorization

Authorization is enforced server-side inside tRPC procedure calls by checking the user's role parameters in the database.

### Authorization Enforcement Matrix

| Action / Capability | Org Owner | Project Manager | Project Reviewer |
| :--- | :---: | :---: | :---: |
| **View Organization Projects** | Yes (all projects) | Yes (assigned projects) | Yes (assigned projects) |
| **Import Dataset Files** | Yes | Yes | No (blocked server-side) |
| **Clear Project Screening Data** | Yes | Yes | No (blocked server-side) |
| **Manage Project Team Members** | Yes | Yes | No (blocked server-side) |
| **Delete Project** | Yes | No (blocked server-side) | No (blocked server-side) |
| **Delete Organization** | Yes | No (blocked server-side) | No (blocked server-side) |
| **Access Org/Proj Settings** | Yes | Yes (Project settings only) | No (blocked server-side) |

### 4.1 Data Isolation & Tenant Boundaries
The application is structured around a strict multi-tenant schema to prevent cross-organization data leakage:
* **Procedural Assertions**: All write operations (mutations) and read operations (queries) invoke procedural assertions in [auth-helpers.ts](./src/server/api/auth-helpers.ts) (e.g., `assertProjectAccess`, `assertOrgOwner`).
* **Session Integrity Checks**: At runtime, procedure calls verify the active user session ID against the database organization membership table. Even if an attacker manually crafts a tRPC payload specifying a target project ID, the server-side gate rejects the operation if they do not belong to that project or organization.

---

## 5. Import Workflow

The Excel import pipeline parses, normalizes, and triages academic citations:
1. **Normalization**: Trims whitespaces, converts DOIs to lowercase, and strips standard "DOI:" URL prefixes.
2. **Deduplication**: Automatically cross-checks incoming articles against the current project by PMID and DOI to identify duplicates.
3. **5-Tier Classification**: Triages rows into `IMPORTED`, `AUTO_CORRECTED`, `IMPORTED_WARNING`, `LIKELY_DUPLICATE`, or `CONFLICT` states.
4. **Interactive Preview**: Step-based wizard lets users review anomalies and choose resolution strategies (e.g. overwrite, import anyway, skip) before committing records to the database.

---

## 6. Testing Guide

EasySLR includes a comprehensive test suite (110 test cases) powered by **Vitest** verifying auth configurations, data normalization, duplicate resolution, and access restrictions.

### Running Tests
* **Run Tests**:
  ```bash
  npm run test
  ```
* **Watch Mode**:
  ```bash
  npm run test:watch
  ```
* **Coverage Details**:
  ```bash
  npm run test:coverage
  ```

---

## 7. Architecture

The system uses a decoupled layout, separating stateless processing from state updates:

```mermaid
graph LR
    Client[Next.js Client UI] -->|tRPC| Server[tRPC Server Router]
    Client -->|NextAuth| NextAuth[NextAuth.js]
    Server -->|Auth Gates| AuthGates[Auth Gates]
    Server -->|Prisma| DB[(PostgreSQL Database)]
    Server -->|SheetJS| Engine[Import Triage Engine]
```

### 7.1 Database Entity-Relationship (ER) Model
The application data models are defined using strict relational integrity as shown in the diagram below:

```mermaid
erDiagram
    Organization ||--o{ Project : "contains"
    Organization ||--o{ OrganizationMember : "has"
    Project ||--o{ ProjectMember : "has"
    Project ||--o{ Article : "contains"
    Project ||--o{ ImportBatch : "executes"
    User ||--o{ OrganizationMember : "is"
    User ||--o{ ProjectMember : "is"
    ImportBatch ||--o{ ImportRowResult : "records"
    Article ||--o{ ImportRowResult : "matches"
```

### 7.2 Codebase Tour
A quick guide to navigating the core folders and files in the codebase:
* `src/server/api/routers/` - Contains our tRPC backend endpoints:
  * [article.ts](./src/server/api/routers/article.ts) - Article CRUD, search, pagination, sorting, and status updates.
  * [import.ts](./src/server/api/routers/import.ts) - Handles Excel parsing, triage validation, and import execution.
  * [organization.ts](./src/server/api/routers/organization.ts) - Organization membership management, inviting users, and updating slug URLs.
* `src/server/import/` - The core stateless Excel processing logic:
  * [triage.ts](./src/server/import/triage.ts) - The 5-tier classification engine mapping PMID and DOI duplicate boundaries.
* `src/app/` - The Next.js frontend pages and components:
  * `(app)/project/[projectId]/_components/` - Interactive dashboard widgets (e.g. `ArticleTable`, `ImportWizard`, `BulkActionBar`).
  * `auth/` - Custom login and signup views (strictly passwordless / OAuth only).
* `prisma/` - Database sync assets:
  * `schema.prisma` - DB layout defining organizations, members, projects, and articles.
  * `seed.ts` - Populates the local system with standard demo accounts.

---

## 8. Explicit Assumptions

1. **Single-Reviewer Schema Model**: The review decision (`reviewStatus`, `reviewNote`, `reviewedById`) is stored directly on the `Article` record, assuming one reviewer screens each article.
2. **English Language Processing**: The text-to-year auto-correction engine expects English number spellings.
3. **Structured Identification**: The deduplication logic requires a `PMID` or `DOI` to identify duplicates.

---

## 9. Tradeoffs

1. **Base64 tRPC Uploads vs. Multipart Streaming**: Excel files are uploaded as Base64 strings inside JSON payloads via tRPC. This is simple and type-safe for datasets under 10MB, but direct streaming would scale better for larger files.
2. **PostgreSQL vs. SQLite in Tests**: The test suite runs against a live PostgreSQL schema to ensure exact SQL capability matching (e.g. case-insensitive indexes, array constraints, transactions) rather than mocking database details.
3. **Server-Side CSV Export**: Exporting project data as a CSV is handled on a dedicated server route (`/api/project/[projectId]/export`), which allows exporting the entire project dataset securely.

---

## 10. Deployment Status

* **Build Configuration**: The project is configured and validated for standard production Next.js builds.
* **Database Migrations**: Production deployments run database schema changes using `npx prisma migrate deploy` to safely apply migrations.

---

## 11. Future Improvements

1. **Double-Blind Screening**: Move review states to a separate join table linking `User` and `Article` to support blinded screening.
2. **Fuzzy String Deduplication**: Add fuzzy text comparisons on title fields for articles lacking PMIDs and DOIs.

---

## 12. AI Usage & Time Spent

* **Estimated Time Spent**: ~22 hours (8 hours design & schema modeling, 8 hours UI/UX development, 6 hours testing & production auditing).
* **AI Tools Used**: **Antigravity**, an agentic AI coding assistant designed by Google DeepMind.
* **Parts of Work AI-Assisted**:
  - Boilerplate generation of the tRPC router setup.
  - Draft of the initial database schema structure.
  - Writing automated test suites (mock context definitions).
* **Personally Verified**:
  - Database schema referential integrity, indexes, and constraints.
  - The 110 unit and integration test behaviors and database transaction mocks.
  - Next.js production compiler optimization output.
  - All tRPC server-side role validation assertions (`assertProjectAccess`, `assertOrgOwner`, etc.).
* **Example of Changed/Corrected/Rejected Output**:
  - During the final security audit, the AI assistant proposed keeping a development credentials bypass using an `EVALUATOR_MODE` environment variable. We **rejected** this approach to avoid leaving test backdoors in the codebase, choosing instead to enforce the production magic-link login path with a local SMTP catcher (Maildev) for clean security practices.
  - The AI assistant's initial Excel publication year parser was unable to handle decimal spellings (e.g. `2023.0`) or word-based written years (e.g., `two thousand twenty-three`). We **corrected** the parsing logic by adding a helper to extract digit substrings and map common spelled years, avoiding empty years on imports.
