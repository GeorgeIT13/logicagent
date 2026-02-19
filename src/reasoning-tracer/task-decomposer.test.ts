import { describe, expect, it } from "vitest";
import { decomposeTask } from "./task-decomposer.js";

describe("decomposeTask", () => {
  it("returns decomposed=false for empty input", () => {
    const result = decomposeTask("");
    expect(result.decomposed).toBe(false);
    expect(result.subtasks).toEqual([]);
  });

  it("returns decomposed=false for a single-step request", () => {
    const result = decomposeTask("Read the file config.json");
    expect(result.decomposed).toBe(false);
    expect(result.subtasks).toEqual([]);
  });

  it("decomposes numbered list with periods", () => {
    const result = decomposeTask("1. Read the file\n2. Update the config\n3. Save changes");
    expect(result.decomposed).toBe(true);
    expect(result.subtasks).toHaveLength(3);
    expect(result.subtasks[0].description).toContain("Read the file");
    expect(result.subtasks[1].description).toContain("Update the config");
    expect(result.subtasks[2].description).toContain("Save changes");
  });

  it("decomposes numbered list with parentheses", () => {
    const result = decomposeTask("1) Create the module\n2) Add tests\n3) Run linting");
    expect(result.decomposed).toBe(true);
    expect(result.subtasks).toHaveLength(3);
  });

  it("assigns sequential indices", () => {
    const result = decomposeTask("1. Step A\n2. Step B\n3. Step C");
    expect(result.decomposed).toBe(true);
    expect(result.subtasks[0].index).toBe(0);
    expect(result.subtasks[1].index).toBe(1);
    expect(result.subtasks[2].index).toBe(2);
  });

  it("decomposes sequential markers with periods", () => {
    const result = decomposeTask(
      "Read the config file. Then update the database. After that restart the server.",
    );
    expect(result.decomposed).toBe(true);
    expect(result.subtasks.length).toBeGreaterThanOrEqual(2);
  });

  it("does not decompose input with only one step and no sequential markers", () => {
    const result = decomposeTask("Deploy the application to production");
    expect(result.decomposed).toBe(false);
  });

  it("collapses multiline descriptions", () => {
    const result = decomposeTask("1. Create a new\n   module file\n2. Write tests");
    expect(result.decomposed).toBe(true);
    expect(result.subtasks[0].description).not.toContain("\n");
  });

  it("handles whitespace-only input", () => {
    const result = decomposeTask("   \n  \t  ");
    expect(result.decomposed).toBe(false);
  });
});
