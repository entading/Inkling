import { createRouter, createWebHistory } from 'vue-router'
import Home from './views/Home.vue'
import Board from './views/Board.vue'
import NoteView from './views/NoteView.vue'
import EditView from './views/EditView.vue'
import NewNote from './views/NewNote.vue'
import Tags from './views/Tags.vue'
import TagDetail from './views/TagDetail.vue'
import Settings from './views/Settings.vue'
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
    { path: '/v/:board/:slug/edit', name: 'note-edit', component: EditView },
    { path: '/new', name: 'new-note', component: NewNote },
    { path: '/tags', name: 'tags', component: Tags },
    { path: '/tags/:tag', name: 'tag-detail', component: TagDetail },
    { path: '/settings', name: 'settings', component: Settings },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFound },
  ],
})

router.afterEach((to) => {
  if (to.name === 'note') {
    document.title = `Inkling · ${String(to.params.slug)}`
  } else if (to.name === 'note-edit') {
    document.title = `Inkling · 编辑 ${String(to.params.slug)}`
  } else if (to.name === 'new-note') {
    document.title = 'Inkling · 新建词条'
  } else if (to.name === 'tag-detail') {
    document.title = `Inkling · #${String(to.params.tag)}`
  } else {
    document.title = 'Inkling'
  }
})

export default router
