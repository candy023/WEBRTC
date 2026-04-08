import { createApp } from "vue";
import App from "./App.vue";
import router from "./router/index.js";
import "./assets/main.css"; // Tailwind (または style.css) を読み込む

createApp(App).use(router).mount("#app");
