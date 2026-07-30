<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { loadNoasVersion } from '../lib/version';

  let {
    wide = false,
    versionLabel: versionLabelProp = undefined,
    children,
  }: {
    wide?: boolean;
    /** Pass this when the page already fetches /.well-known/nostr.json itself, to avoid a duplicate fetch. */
    versionLabel?: string;
    children?: Snippet;
  } = $props();

  let ownVersionLabel = $state('');
  const versionLabel = $derived(versionLabelProp ?? ownVersionLabel);

  onMount(async () => {
    if (versionLabelProp !== undefined) return;
    const metadata = await loadNoasVersion();
    if (metadata) ownVersionLabel = metadata.versionLabel;
  });
</script>

<div class="site-shell">
  <header class="site-header">
    <div class="site-header-inner">
      <a class="logo-link" href="/">
        <span class="logo-mark" aria-hidden="true">N</span>
        <span class="logo-word">noas</span>
      </a>
    </div>
  </header>

  <main class="site-main" class:main-centered={!wide} class:main-wide={wide}>
    {@render children?.()}
  </main>

  <footer class="site-footer">
    <div class="site-footer-inner">
      <span>noas · nostr authentication server</span>
      <span class="site-footer-right">
        <a href="/docs">API docs</a>
        <span id="noasVersionFooter">{versionLabel}</span>
      </span>
    </div>
  </footer>
</div>
