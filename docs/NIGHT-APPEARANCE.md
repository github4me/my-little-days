# Night appearance and recording inputs

18 September 2026. Local baseline tag: `pre-night-theme-2026-09-18` at `7c9e752`.

## Direction and scope

Parents record care one-handed in a dim room. Keep the familiar layout, system
type, readable labels and existing light appearance; remove the broad blue wash
and bright pastel islands from night mode. Dark neutral base, lighter grouped
surfaces and raised sheets establish depth. Blue identifies actions and selected
controls. Record-category colors are subdued, while labels/icons still identify
the category without relying on color alone. Do not invert baby photos.

The first viewport retains the baby summary and care actions; editors keep their
save action after the fields. Native wheel selection changes a draft, with explicit
confirmation/cancellation for care time. No decorative motion or new navigation.

This is a scoped appearance change, not a new product identity. Apple’s guidance
informs surface elevation, semantic color roles, readable contrast and adapting
native controls. Keep the existing System/Light/Night preference, with System as
the default; the selected appearance must also reach keyboards and pickers.

Sources: [Apple Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode),
[Apple dark-interface evaluation](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/dark-interface-evaluation-criteria).

## Implementation and acceptance

`src/palette.ts` is the shared semantic palette. Night tokens include base
`#101113`, grouped `#1C1C1E`, elevated `#2C2C2E`, text `#F2F2F7`, secondary
`#B5B5BA`, and interactive blue `#84B9E5` with a dark on-primary foreground.
Automated checks cover foreground/background contrast and surface ordering.

Save-location copy must describe the active workspace, not assume that sign-in
uploads records. Shared records can be saved locally while waiting to synchronize;
the message must not claim they are already synchronized.

Release through a native iOS preview build: OTA remains disabled. Browser checks
are useful for layout/flows but do not verify the native wheel or keyboard. On the
installed preview, check all five care categories, cancel/confirm, current-minute
and birth-date limits, existing-record editing, night keyboard/picker, System mode,
large text, Increase Contrast, iPhone and iPad. Never uninstall or erase real data
to run these checks.
