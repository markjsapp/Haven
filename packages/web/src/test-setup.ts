import "@testing-library/jest-dom";
import { expect } from "vitest";
import * as matchers from "vitest-axe/matchers";
import "./i18n/index.js";

expect.extend(matchers);

// Augment vitest types with vitest-axe matchers
declare module "vitest" {
  interface Assertion<T> {
    toHaveNoViolations(): T;
  }
}
