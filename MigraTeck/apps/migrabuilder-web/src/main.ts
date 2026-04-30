import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './styles/index.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: () => import('./views/SitesDashboard.vue'),
    },
    {
      path: '/sites/:siteId/pages/:pageId',
      component: () => import('./views/EditorView.vue'),
    },
  ],
});

const app = createApp(App);
app.use(router);
app.mount('#app');
