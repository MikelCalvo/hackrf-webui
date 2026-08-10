import assert from "node:assert/strict";
import test from "node:test";

import { authorizeApiRequest } from "@/server/api/auth";

test("authorizeApiRequest accepts equivalent loopback origins", () => {
  const request = new Request("http://localhost:3000/api/radio/sessions", {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:3000",
    },
  });

  assert.equal(authorizeApiRequest(request, { sensitive: true }), null);
});

test("authorizeApiRequest normalizes default loopback ports", () => {
  const request = new Request("http://localhost/api/radio/sessions", {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:80",
    },
  });

  assert.equal(authorizeApiRequest(request, { sensitive: true }), null);
});

test("authorizeApiRequest rejects equivalent loopback hosts on different ports", () => {
  const request = new Request("http://localhost:3000/api/radio/sessions", {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:3001",
    },
  });

  assert.equal(authorizeApiRequest(request, { sensitive: true })?.status, 403);
});

test("authorizeApiRequest still rejects unrelated origins", async () => {
  const request = new Request("http://localhost:3000/api/radio/sessions", {
    method: "POST",
    headers: {
      Origin: "https://example.com",
    },
  });

  const response = authorizeApiRequest(request, { sensitive: true });
  assert.equal(response?.status, 403);
  assert.deepEqual(await response?.json(), {
    message: "Origin is not allowed for this API request.",
  });
});
