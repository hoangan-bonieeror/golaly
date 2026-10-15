// Lint config for the whole monorepo (ESLint 9 flat config). Run: npm run lint
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/generated/**", "apps/web/public/**", "**/*.cjs", "**/next-env.d.ts", "apps/web/e2e/artifacts/**", "pipelines/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["apps/api/**/*.ts", "packages/shared/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
    settings: { next: { rootDir: "apps/web" } },
  },
  {
    files: ["**/*.spec.ts", "**/test/**/*.ts", "**/prisma/seed*.ts", "**/prisma/demo-trip.ts", "**/prisma/analytics-demo.ts", "**/prisma/seed-data/**", "**/scripts/**", "**/e2e/**"],
    rules: { "no-console": "off" },
  },
);
