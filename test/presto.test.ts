import { describe, it, expect } from "vitest";
import { loadSpec } from "../src/spec-loader.js";
import { buildTools } from "../src/tool-builder.js";
import { resolveBaseUrl } from "../src/executor.js";
import { resolveAuthHeaders } from "../src/auth.js";

describe("PResto OpenAPI spec", () => {
  it("loads remote spec and builds correct tools", async () => {
    const specUrl =
      "https://wtf.presto.wtf/functions/v1/external-api/openapi.yaml";
    const spec = await loadSpec(specUrl);
    const tools = buildTools(spec);
    const baseUrl = resolveBaseUrl(spec.servers?.[0]?.url, specUrl);

    console.log("Base URL:", baseUrl);
    console.log("Tools:", tools.length);
    for (const t of tools) {
      console.log();
      console.log(`### ${t.name}`);
      console.log(`  ${t.method} ${t.pathTemplate}`);
      console.log(`  Description: ${t.description}`);
      console.log(`  Path params: ${t.pathParams.join(", ") || "none"}`);
      console.log(`  Query params: ${t.queryParams.join(", ") || "none"}`);
      console.log(`  Has body: ${t.hasBody}`);
      console.log(
        `  Required: ${t.inputSchema.required.join(", ") || "none"}`
      );
      console.log(
        `  Properties: ${Object.keys(t.inputSchema.properties).join(", ")}`
      );
    }

    // Verify tool count
    expect(tools.length).toBe(5);

    // Verify base URL
    expect(baseUrl).toBe(
      "https://wtf.presto.wtf/functions/v1/external-api"
    );

    // listReviews
    const listReviews = tools.find((t) => t.name === "listReviews");
    expect(listReviews).toBeDefined();
    expect(listReviews!.method).toBe("GET");
    expect(listReviews!.pathTemplate).toBe("/prs");
    expect(listReviews!.queryParams).toEqual([
      "page",
      "per_page",
      "repo",
      "status",
      "pr_status",
      "pr_number",
    ]);

    // getReview
    const getReview = tools.find((t) => t.name === "getReview");
    expect(getReview).toBeDefined();
    expect(getReview!.pathParams).toEqual(["reviewId"]);
    expect(getReview!.inputSchema.required).toContain("reviewId");

    // listIssues
    const listIssues = tools.find((t) => t.name === "listIssues");
    expect(listIssues).toBeDefined();
    expect(listIssues!.pathParams).toEqual(["reviewId"]);
    expect(listIssues!.queryParams).toEqual(["severity", "resolved"]);

    // postComment
    const postComment = tools.find((t) => t.name === "postComment");
    expect(postComment).toBeDefined();
    expect(postComment!.method).toBe("POST");
    expect(postComment!.hasBody).toBe(true);
    expect(postComment!.inputSchema.required).toContain("body");

    // Auth resolution with OPENAPI_API_KEY
    const headers = resolveAuthHeaders(spec, {
      cliHeaders: {},
      env: { OPENAPI_API_KEY: "pk_test123" },
    });
    expect(headers["X-API-Key"]).toBe("pk_test123");
  });
});
