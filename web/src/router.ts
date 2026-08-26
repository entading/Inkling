import { createRouter, createWebHistory } from 'vue-router'
import Home from './views/Home.vue'
import Board from './views/Board.vue'
import NoteView from './views/NoteView.vue'
import NotFound from './views/NotFound.vue'
import type { Board as BoardName } from './api'

export const boardRoutes = [
  { path: '/vocab', board: 'vocab' as BoardName, label: '词汇' },
  { path: '/phrase', board: 'phrase' as BoardName, label: '短语' },
  { path: '/sentence', board: 'sentence' as BoardName, label: '长难句' },
  { path: '/grammar', board: 'grammar' as BoardName, label: '语法' },
]

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    ...boardRoutes.map((r) => ({
      path: r.path,
      name: r.board,
      component: Board,
      props: { board: r.board },
    })),
    { path: '/v/:board/:slug', name: 'note', component: NoteView },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFound },
  ],
})

router.afterEach((to) => {
  document.title = to.name === 'note'
    ? `EN_tool · ${String(to.params.slug)}`
    : 'EN_tool'
})

export default router
