<script setup lang="ts">
// A slim, always-visible note at the top of every page (doc pages via the `doc-before`
// slot, the home page via `home-hero-before`). Not dismissible on purpose.
defineProps<{ home?: boolean }>()
const issuesUrl = 'https://github.com/antoniucraciun/GameDevPatterns/issues'
</script>

<template>
  <div class="ai-disclaimer-wrap" :class="{ home }">
    <p class="ai-disclaimer" role="note">
      <span class="label">Heads up:</span>
      This site is AI-assisted and still being proofread. Code examples, especially Godot and
      Unreal, may contain mistakes. Found one? Please
      <a :href="issuesUrl" target="_blank" rel="noopener">open an issue</a>.
    </p>
  </div>
</template>

<style scoped>
.ai-disclaimer-wrap {
  margin: 0 0 24px;
}
.ai-disclaimer-wrap.home {
  max-width: 1152px;
  margin: 0 auto;
  padding: 16px 24px 0;
}
@media (min-width: 640px) {
  .ai-disclaimer-wrap.home { padding: 20px 48px 0; }
}
@media (min-width: 960px) {
  .ai-disclaimer-wrap.home { padding: 24px 64px 0; }
}

.ai-disclaimer {
  margin: 0;
  padding: 8px 12px;
  border-left: 3px solid var(--vp-c-warning-1);
  border-radius: 4px;
  background: var(--vp-c-warning-soft);
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.label {
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.ai-disclaimer a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.ai-disclaimer a:hover {
  color: var(--vp-c-brand-2);
}
</style>
