import assert from "node:assert/strict";
import http from "node:http";
import {
  apiFetch,
  createHttpFetch,
  isTransientFetchError,
  networkErrorCode,
} from "./api-fetch.mjs";

const immediate = async () => {};

function fetchFailedReset() {
  const err = new TypeError("fetch failed");
  err.cause = Object.assign(new Error("read ECONNRESET"), {
    errno: -104,
    code: "ECONNRESET",
    syscall: "read",
  });
  return err;
}

assert.equal(networkErrorCode(fetchFailedReset()), "ECONNRESET");
assert.equal(isTransientFetchError(fetchFailedReset()), true);
assert.equal(isTransientFetchError(new Error("claim 401: Unauthorized")), false);
assert.equal(isTransientFetchError(new TypeError("something else")), false);

{
  let calls = 0;
  const res = await apiFetch(
    "http://example.test/api/worker/claim",
    { method: "POST" },
    {
      sleepImpl: immediate,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw fetchFailedReset();
        return new Response(JSON.stringify({ job: null }), { status: 200 });
      },
    },
  );
  assert.equal(calls, 2);
  assert.equal(res.ok, true);
  assert.deepEqual(await res.json(), { job: null });
}

{
  let calls = 0;
  await assert.rejects(
    () =>
      apiFetch(
        "http://example.test/api/worker/claim",
        { method: "POST" },
        {
          attempts: 3,
          sleepImpl: immediate,
          fetchImpl: async () => {
            calls += 1;
            throw fetchFailedReset();
          },
        },
      ),
    (err) => isTransientFetchError(err),
  );
  assert.equal(calls, 3);
}

{
  let calls = 0;
  const res = await apiFetch(
    "http://example.test/api/worker/claim",
    { method: "POST" },
    {
      sleepImpl: immediate,
      fetchImpl: async () => {
        calls += 1;
        return new Response("nope", { status: 401 });
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(res.status, 401);
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

{
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (hits === 1) {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ job: null }));
  });
  const port = await listen(server);
  try {
    const res = await apiFetch(
      `http://127.0.0.1:${port}/api/worker/claim`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workerId: "forge-1" }),
      },
      {
        sleepImpl: immediate,
        fetchImpl: createHttpFetch({ family: 4, timeoutMs: 2000 }),
      },
    );
    assert.equal(hits, 2);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { job: null });
  } finally {
    await close(server);
  }
}

{
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (req.url === "/next") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(302, { location: "/next" });
    res.end();
  });
  const port = await listen(server);
  try {
    const res = await apiFetch(
      `http://127.0.0.1:${port}/claim`,
      { method: "GET" },
      {
        attempts: 1,
        fetchImpl: createHttpFetch({ family: 4, timeoutMs: 2000 }),
      },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(hits, 2);
  } finally {
    await close(server);
  }
}

console.log("api-fetch.test.mjs ok");
