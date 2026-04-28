import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";

describe("Architecture Rules", () => {
  it("should not have circular dependencies", async () => {
    const rule = projectFiles().inFolder("src/**").should().haveNoCycles();

    await expect(rule).toPassAsync();
  });

  it("should ensure util modules have no dependencies on forge modules", async () => {
    const rule = projectFiles()
      .inFolder("src/util/**")
      .shouldNot()
      .dependOnFiles()
      .inFolder("src/forge/**");

    await expect(rule).toPassAsync();
  });

  //TODO: Some metrics-based rules would be nice too.
});
