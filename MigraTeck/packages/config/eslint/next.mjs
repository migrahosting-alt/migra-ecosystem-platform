import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import baseConfig from "./base.mjs";

export default defineConfig([
  ...baseConfig,
  ...nextVitals,
  ...nextTs
]);
