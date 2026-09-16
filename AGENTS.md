# Repository Guidelines

## Collaboration preferences

When information or a material decision is needed from the user, use the available `grilling` ("grill me") skill for concise, dependency-aware questions. First resolve discoverable facts from the repository and tools; do not ask about choices already agreed in the conversation.

Use the GitHub plugin for future commits and pushes to GitHub. Do not default to command-line pushes or open local Git credential/login windows. Local Git inspection and fetching remain available for verification and keeping the checkout aligned. If the plugin is unavailable, explain the blocker before choosing another publishing method.

## Project Structure & Module Organization

This is an offline baby-growth tracker built with Expo, React Native, and TypeScript. `App.tsx` owns top-level navigation and screen composition. Application modules live in `src/`: domain models and statistics in `domain.ts`, persistence in `storage.ts` (with browser counterparts such as `storage.web.ts`), and feature UI in components such as `EntryEditor.tsx` and `Settings.tsx`. Keep static images and bundled WHO reference data in `assets/`; keep supporting documentation in `docs/`. Unit tests sit beside their subjects as `src/*.test.ts`; end-to-end browser coverage is in `tests/browser.mjs`.

## Build, Test, and Development Commands

- `npm ci` installs the locked dependency set.
- `npm start` launches the Expo development server; `npm run android`, `npm run ios`, and `npm run web` target a platform directly.
- `npm run typecheck` checks strict TypeScript without emitting files.
- `npm test` runs `src/*.test.ts` through Node and `tsx`.
- `npm run verify` runs the type check and unit suite; use it before review.
- `npm run export:web` or `npm run export:ios` creates production JavaScript bundles. For browser regression, run `npm run export:web`, then `npx playwright install chromium` once and `npm run test:browser`.

## Coding Style & Naming Conventions

Use TypeScript with strict typing and follow the surrounding code’s two-space indentation, semicolons, and single quotes. Name React components in PascalCase (`GrowthChart.tsx`), hooks and functions in camelCase, and platform variants with Expo’s suffixes (`backup.web.ts`). Prefer small, typed domain helpers over duplicating data rules in screens. Run `npm run format` after edits to `App.tsx`, `src/`, or `tests/`; the repository uses Prettier and has no ESLint configuration.

## Testing Guidelines

Add focused `*.test.ts` coverage for changes to validation, imports/exports, time calculations, statistics, or growth references. Include boundary cases such as invalid values, daylight-saving transitions, and overlapping sleep periods when relevant. Browser-flow changes should be exercised with `npm run test:browser`; native SQLite, notifications, and file sharing still need device validation as documented in `docs/VALIDATION.md`.

## Commit & Pull Request Guidelines

This repository has no existing commit history to infer a convention from. Use concise, imperative subject lines such as `Fix sleep duration across midnight`. Keep commits scoped. Pull requests should describe the user-visible change, list verification performed, link the relevant issue when one exists, and include screenshots for UI changes. Call out any untested iOS-native behavior explicitly.
