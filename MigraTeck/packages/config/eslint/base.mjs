import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [
      "**/.next/**",
      "**/.turbo/**",
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**"
    ]
  }
]);
