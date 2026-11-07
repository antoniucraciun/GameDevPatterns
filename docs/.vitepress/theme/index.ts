import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import PatternCatalog from './PatternCatalog.vue'
import RecipeCatalog from './RecipeCatalog.vue'
import PageRelations from './PageRelations.vue'
import SidebarResizer from './SidebarResizer.vue'
import EngineTabs from './EngineTabs.vue'
import FixedTimestepViz from './viz/FixedTimestepViz.vue'
import SpatialPartitionViz from './viz/SpatialPartitionViz.vue'
import AStarViz from './viz/AStarViz.vue'
import JumpTimingViz from './viz/JumpTimingViz.vue'
import FlowFieldViz from './viz/FlowFieldViz.vue'
import CellularAutomataViz from './viz/CellularAutomataViz.vue'
import BspDungeonViz from './viz/BspDungeonViz.vue'
import NetSyncViz from './viz/NetSyncViz.vue'
import SteeringViz from './viz/SteeringViz.vue'
import DoubleBufferViz from './viz/DoubleBufferViz.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'doc-footer-before': () => h(PageRelations),
      'layout-bottom': () => [h(SidebarResizer), h(EngineTabs)],
    }),
  enhanceApp({ app }) {
    app.component('PatternCatalog', PatternCatalog)
    app.component('RecipeCatalog', RecipeCatalog)
    // Interactive visualizers, placed in pattern pages as <FixedTimestepViz /> etc.
    app.component('FixedTimestepViz', FixedTimestepViz)
    app.component('SpatialPartitionViz', SpatialPartitionViz)
    app.component('AStarViz', AStarViz)
    app.component('JumpTimingViz', JumpTimingViz)
    app.component('FlowFieldViz', FlowFieldViz)
    app.component('CellularAutomataViz', CellularAutomataViz)
    app.component('BspDungeonViz', BspDungeonViz)
    app.component('NetSyncViz', NetSyncViz)
    app.component('SteeringViz', SteeringViz)
    app.component('DoubleBufferViz', DoubleBufferViz)
  },
} satisfies Theme
