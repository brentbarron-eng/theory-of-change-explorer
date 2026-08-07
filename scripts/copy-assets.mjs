import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync(new URL('../assets/fonts/', import.meta.url), { recursive: true });

// Logo (source lives in gitignored brand/; output assets/ is committed)
copyFileSync(
  new URL('../brand/CIFAR logo WHITE.png', import.meta.url),
  new URL('../assets/cifar-logo-white.png', import.meta.url),
);

// Fira Sans latin woff2, weights 400/500/700/900
for (const w of [400, 500, 700, 900]) {
  copyFileSync(
    new URL(`../node_modules/@fontsource/fira-sans/files/fira-sans-latin-${w}-normal.woff2`, import.meta.url),
    new URL(`../assets/fonts/fira-sans-${w}.woff2`, import.meta.url),
  );
}
console.log('assets copied: logo + Fira Sans 400/500/700/900');
