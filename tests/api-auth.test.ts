import test from "node:test";
import assert from "node:assert/strict";

import {
  authorizeApiRequest,
  isLoopbackHostname,
  maybeExposeClientToken,
} from "@/server/api/auth";

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    previous.set(key, process.env[key]);
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("isLoopbackHostname only treats localhost names and loopback addresses as local", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("127.42.0.9"), true);
  assert.equal(isLoopbackHostname("[::1]"), true);
  assert.equal(isLoopbackHostname("192.168.1.20"), false);
  assert.equal(isLoopbackHostname("hackrf.local"), false);
});

test("authorizeApiRequest allows local sensitive requests without a token", () => {
  withEnv({ HACKRF_WEBUI_TOKEN: undefined }, () => {
    const request = new Request("http://localhost:3000/api/radio/debug");
    assert.equal(authorizeApiRequest(request, { sensitive: true }), null);
  });
});

test("authorizeApiRequest blocks remote sensitive requests until a token is configured", async () => {
  await withEnv({ HACKRF_WEBUI_TOKEN: undefined }, async () => {
    const request = new Request("http://192.168.1.20:3000/api/radio/debug");
    const failure = authorizeApiRequest(request, { sensitive: true });
    assert.equal(failure?.status, 403);
    assert.match(await failure!.text(), /HACKRF_WEBUI_TOKEN/);
  });
});

test("authorizeApiRequest accepts bearer, custom header, and query tokens", () => {
  withEnv({ HACKRF_WEBUI_TOKEN: "secret" }, () => {
    const bearer = new Request("http://192.168.1.20:3000/api/radio/sessions", {
      headers: { Authorization: "Bearer secret" },
    });
    const customHeader = new Request("http://192.168.1.20:3000/api/radio/sessions", {
      headers: { "X-HackRF-WebUI-Token": "secret" },
    });
    const query = new Request("http://192.168.1.20:3000/api/radio/sessions/abc/events?apiToken=secret");

    assert.equal(authorizeApiRequest(bearer, { sensitive: true }), null);
    assert.equal(authorizeApiRequest(customHeader, { sensitive: true }), null);
    assert.equal(authorizeApiRequest(query, { sensitive: true, allowQueryToken: true }), null);
  });
});

test("authorizeApiRequest rejects cross-origin unsafe requests", async () => {
  await withEnv({ HACKRF_WEBUI_TOKEN: "secret" }, async () => {
    const request = new Request("http://192.168.1.20:3000/api/radio/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        Origin: "http://evil.example",
      },
    });

    const failure = authorizeApiRequest(request, { sensitive: true });
    assert.equal(failure?.status, 403);
    assert.match(await failure!.text(), /Origin/);
  });
});

test("maybeExposeClientToken mirrors the server token only when a public token is not already set", () => {
  withEnv(
    { HACKRF_WEBUI_TOKEN: "server-token", NEXT_PUBLIC_HACKRF_WEBUI_TOKEN: undefined },
    () => {
      assert.equal(maybeExposeClientToken(), "server-token");
    },
  );

  withEnv(
    { HACKRF_WEBUI_TOKEN: "server-token", NEXT_PUBLIC_HACKRF_WEBUI_TOKEN: "browser-token" },
    () => {
      assert.equal(maybeExposeClientToken(), "browser-token");
    },
  );
});
