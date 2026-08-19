// Compatibility bridge: execute legacy Collectish files with classic-script semantics
// while Vite owns bundling, hashing, ordering and chunk boundaries.
export function runClassic(source, label='legacy-script') {
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.dataset.collectishBundledSource = label;
  script.textContent = `${source}\n//# sourceURL=${label}`;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

export function runClassicSequence(entries) {
  for (const [label, source] of entries) runClassic(source, label);
}
