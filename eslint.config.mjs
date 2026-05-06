import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // eslint-plugin-react-hooks 7 enables React Compiler-adjacent checks that
      // are too noisy for the current local-first dashboard codebase. Keep the
      // existing lint baseline stable for 1.0.0 and tackle these as a focused
      // React cleanup later.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local runtime/build caches:
    ".cache/**",
    "runtime/**",
  ]),
]);

export default eslintConfig;
