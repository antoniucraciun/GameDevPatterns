import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import PatternCatalog from './PatternCatalog.vue'
import RecipeCatalog from './RecipeCatalog.vue'
import PageRelations from './PageRelations.vue'
import SidebarResizer from './SidebarResizer.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'doc-footer-before': () => h(PageRelations),
      'layout-bottom': () => h(SidebarResizer),
    }),
  enhanceApp({ app }) {
    app.component('PatternCatalog', PatternCatalog)
    app.component('RecipeCatalog', RecipeCatalog)
  },
} satisfies Theme
