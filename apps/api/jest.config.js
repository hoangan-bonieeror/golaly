/** @type {import('jest').Config} */
const tsJest = ["ts-jest", { tsconfig: "tsconfig.json" }];
module.exports = {
  projects: [
    {
      displayName: "unit",
      testEnvironment: "node",
      rootDir: ".",
      testMatch: ["<rootDir>/src/**/*.spec.ts"],
      transform: { "^.+\\.ts$": tsJest },
      setupFiles: ["<rootDir>/test/setup-env.ts"],
    },
    {
      displayName: "integration",
      testEnvironment: "node",
      rootDir: ".",
      testMatch: ["<rootDir>/test/**/*.int.ts"],
      transform: { "^.+\\.ts$": tsJest },
      setupFiles: ["<rootDir>/test/setup-env.ts"],
      globalSetup: "<rootDir>/test/global-setup.ts",
      testTimeout: 30000,
    },
  ],
};
