// Ambient shim for @phosphor-icons/react.
//
// The published 2.1.x package ships an incomplete type build: package.json points
// `types` at ./dist/index.d.ts, but that file (and ./dist/lib/types.d.ts, which
// every per-icon .d.ts imports `Icon` from) are missing from the tarball. The
// runtime JS is intact, so components render — TypeScript just can't find any
// declarations, surfacing as TS7016 under `strict`.
//
// A shorthand ambient declaration makes every named icon import resolve (as any);
// the reusable `Icon` component TYPE we actually annotate props with lives in
// @/lib/icon so it stays precise.
declare module "@phosphor-icons/react";
declare module "@phosphor-icons/react/dist/ssr";
