<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import NoasLogo from './NoasLogo.svelte';
  import { loadNoasVersion } from '../lib/version';

  let {
    wide = false,
    header = true,
    footerStart,
    footerEnd,
    children,
  }: {
    wide?: boolean;
    /** The landing/sign-in page omits the header — the logo already appears in the hero. */
    header?: boolean;
    /** Extra actions rendered at the left/right of the pinned footer bar (Portal's Delete account / Sign out). */
    footerStart?: Snippet;
    footerEnd?: Snippet;
    children?: Snippet;
  } = $props();

  let versionLabel = $state('');

  onMount(async () => {
    const metadata = await loadNoasVersion();
    if (metadata) versionLabel = metadata.versionLabel;
  });
</script>

<div class="site-shell">
  {#if header}
    <header class="site-header">
      <div class="site-header-inner">
        <a class="logo-link" href="/">
          <NoasLogo class="logo-mark" />
          <span class="logo-word">noas</span>
        </a>
      </div>
    </header>
  {/if}

  <main class="site-main" class:main-centered={!wide} class:main-wide={wide}>
    {@render children?.()}
  </main>

  <footer class="site-footer">
    <div class="site-footer-inner">
      <div class="site-footer-actions site-footer-start">
        {@render footerStart?.()}
      </div>
      <div class="site-footer-meta">
        <a href="/docs">API docs</a>
        {#if versionLabel}<span class="site-footer-version">{versionLabel}</span>{/if}
      </div>
      <div class="site-footer-actions site-footer-end">
        {@render footerEnd?.()}
      </div>
    </div>
  </footer>
</div>
