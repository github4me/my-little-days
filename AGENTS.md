# Repository Guidelines

## Collaboration preferences

When information or a material decision is needed from the user, use the available `grilling` ("grill me") skill for concise, dependency-aware questions. First resolve discoverable facts from the repository and tools; do not ask about choices already agreed in the conversation.

Use the GitHub plugin for future commits and pushes to GitHub. Do not default to command-line pushes or open local Git credential/login windows. Local Git inspection and fetching remain available for verification and keeping the checkout aligned. If the plugin is unavailable, explain the blocker before choosing another publishing method.

## Apple-first design standard

The user requires **all app design**, not only Night mode, to follow the current [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines). Apply this to existing screens when changing them and to all new UI/UX: navigation, forms, recording flows, settings, account/family management, dialogs, feedback, accessibility and both appearances. Apple's platform guidance takes precedence over generic design-skill aesthetics or custom styling preferences.

- Prefer native iOS controls and familiar interaction patterns where supported. Custom controls must preserve expected behavior, accessibility and consistency; a native-looking color scheme alone is not enough. Retain platform-appropriate Android/web behavior rather than copying iOS-only gestures blindly.
- Use clear screen titles, stable top-level navigation, predictable Back/Cancel/Done behavior and appropriate sheets/alerts. Never obscure data-loss, privacy or permission consequences while simplifying a flow.
- Put the user's task before general explanations. Move lengthy introductory/reference copy below the main content into clearly named, initially collapsed help. Keep urgent safety warnings, input-accuracy notes, errors, access limitations and consent consequences visible where they matter; do not hide them to shorten a screen.
- Use system typography and support Dynamic Type without clipping or hiding actions. Target comfortable touch areas of at least 44 × 44 points in this project; provide accessible names, roles, states and a sensible VoiceOver focus order. Do not rely on color alone.
- Respect safe areas, keyboard avoidance, device size/orientation, localized text and iPad layouts. Verify complete forms with the keyboard open, not just static screenshots.
- Prefer semantic/adaptive colors and appropriate surface hierarchy. Support System/Light/Night consistently through content, sheets, pickers, keyboards and status bars; preserve real photo colors. Check Increase Contrast, Reduce Transparency and Reduce Motion as applicable. See [the scoped Night implementation](docs/NIGHT-APPEARANCE.md), which is not a whole-app compliance certificate.
- Give prompt, truthful feedback: distinguish locally saved, pending synchronization, confirmed success and failure. Do not make network-dependent authorization or destructive operations look successful before confirmation.
- Recheck the relevant official HIG pages before a design change. Use native materials and controls supported by the project's OS/framework versions; do not imitate a newer OS effect at the expense of legibility or compatibility.
- Review changed flows in both appearances, Chinese/English, small/large screens and accessibility text sizes. Browser/unit tests supplement physical iOS checks; report unverified native behavior explicitly. Record concrete gaps rather than claiming the entire app follows HIG merely because this policy exists.

Relevant references: [accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [typography](https://developer.apple.com/design/human-interface-guidelines/typography), [layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode) and [color](https://developer.apple.com/design/human-interface-guidelines/color).

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
