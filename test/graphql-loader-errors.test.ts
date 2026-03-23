import { describe, it, expect, vi, afterEach } from "vitest";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGraphQLSchema } from "../src/graphql-loader.js";

// Mock the graphql module so we can simulate graphqlSync returning errors or missing data.
vi.mock("graphql", async (importOriginal) => {
  const original = await importOriginal<typeof import("graphql")>();
  return { ...original, graphqlSync: vi.fn(original.graphqlSync) };
});

describe("loadGraphQLSchema SDL — graphqlSync error paths", () => {
  let sdlPath: string;

  afterEach(async () => {
    try { await unlink(sdlPath); } catch { /* ignore */ }
    vi.restoreAllMocks();
  });

  it("throws when graphqlSync returns errors", async () => {
    const { graphqlSync } = await import("graphql");
    vi.mocked(graphqlSync).mockReturnValueOnce({
      errors: [{ message: "introspection error" } as import("graphql").GraphQLError],
    });

    sdlPath = join(tmpdir(), `test-sdl-err-${Date.now()}.graphql`);
    await writeFile(sdlPath, "type Query { ping: String }", "utf-8");

    await expect(loadGraphQLSchema(sdlPath)).rejects.toThrow(
      "GraphQL introspection failed for SDL file"
    );
  });

  it("throws when graphqlSync returns no __schema in data", async () => {
    const { graphqlSync } = await import("graphql");
    vi.mocked(graphqlSync).mockReturnValueOnce({ data: null });

    sdlPath = join(tmpdir(), `test-sdl-noschema-${Date.now()}.graphql`);
    await writeFile(sdlPath, "type Query { ping: String }", "utf-8");

    await expect(loadGraphQLSchema(sdlPath)).rejects.toThrow(
      "Invalid introspection result from SDL file"
    );
  });

  it("includes string error in message when buildSchema throws non-Error", async () => {
    const graphql = await import("graphql");
    vi.spyOn(graphql, "buildSchema").mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "string error from parser";
    });

    sdlPath = join(tmpdir(), `test-sdl-str-${Date.now()}.graphql`);
    await writeFile(sdlPath, "type Query { ping: String }", "utf-8");

    await expect(loadGraphQLSchema(sdlPath)).rejects.toThrow(
      "string error from parser"
    );
  });
});
