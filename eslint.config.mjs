import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 嵌套子项目与其构建产物：不属于本应用，避免 ESLint 解析海量打包文件导致 OOM。
    "new-api/**",
    "check-cx/**",
    "check-cx-admin/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
