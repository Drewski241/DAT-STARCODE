import assert from "node:assert/strict";
import test from "node:test";
import { flightProvider, normalizeFlightArgs, searchFlights } from "./flights.mjs";

test("normalizes IATA codes and dates", () => {
  assert.deepEqual(
    normalizeFlightArgs({
      origin: "yvr",
      destination: "nrt",
      departDate: "2026-12-15",
    }),
    {
      origin: "YVR",
      destination: "NRT",
      departDate: "2026-12-15",
      returnDate: null,
      adults: 1,
      currency: "CAD",
    },
  );
});

test("says when no inventory API is configured", async () => {
  const text = await searchFlights(
    { origin: "YVR", destination: "LAX", departDate: "2026-12-01" },
    { env: {} },
  );
  assert.match(text, /no inventory API is configured/);
  assert.match(text, /KIWI_API_KEY/);
  assert.equal(text.startsWith("ERROR:"), false);
});

test("kiwi search returns a flight number and booking link", async () => {
  const text = await searchFlights(
    { origin: "YVR", destination: "LAX", departDate: "2026-12-01" },
    {
      env: { KIWI_API_KEY: "test-key", FLIGHTS_PROVIDER: "kiwi" },
      fetchImpl: async (url, init) => {
        assert.match(String(url), /api\.tequila\.kiwi\.com/);
        assert.equal(init.headers.apikey, "test-key");
        return Response.json({
          currency: "CAD",
          data: [
            {
              price: 321,
              route: [
                {
                  flyFrom: "YVR",
                  flyTo: "LAX",
                  airline: "AC",
                  flight_no: 555,
                  local_departure: "2026-12-01T08:00:00.000Z",
                  local_arrival: "2026-12-01T11:00:00.000Z",
                  return: 0,
                },
              ],
              deep_link: "https://www.kiwi.com/booking/abc",
            },
          ],
        });
      },
    },
  );
  assert.match(text, /via kiwi/);
  assert.match(text, /AC555/);
  assert.match(text, /321 CAD/);
  assert.match(text, /https:\/\/www\.kiwi\.com\/booking\/abc/);
});

test("amadeus search maps carrier and flight number", async () => {
  const text = await searchFlights(
    { origin: "YVR", destination: "NRT", departDate: "2026-12-02" },
    {
      env: {
        FLIGHTS_PROVIDER: "amadeus",
        AMADEUS_CLIENT_ID: "id-amplify",
        AMADEUS_CLIENT_SECRET: "secret",
        AMADEUS_ENV: "test",
      },
      fetchImpl: async (url, init) => {
        if (String(url).includes("/oauth2/token")) {
          return Response.json({ access_token: "tok", expires_in: 600 });
        }
        const body = JSON.parse(init.body);
        assert.equal(body.originDestinations[0].destinationLocationCode, "NRT");
        return Response.json({
          data: [
            {
              price: { grandTotal: "812.40", currency: "CAD" },
              itineraries: [
                {
                  segments: [
                    {
                      departure: { iataCode: "YVR", at: "2026-12-02T13:40:00" },
                      arrival: { iataCode: "NRT", at: "2026-12-03T16:05:00" },
                      carrierCode: "AC",
                      number: "3",
                    },
                  ],
                },
              ],
            },
          ],
        });
      },
    },
  );
  assert.match(text, /via amadeus/);
  assert.match(text, /AC3/);
  assert.match(text, /812\.40 CAD/);
});

test("auto prefers amadeus when both keys exist", () => {
  assert.equal(
    flightProvider({
      KIWI_API_KEY: "k",
      AMADEUS_CLIENT_ID: "id",
      AMADEUS_CLIENT_SECRET: "s",
    }),
    "amadeus",
  );
});
