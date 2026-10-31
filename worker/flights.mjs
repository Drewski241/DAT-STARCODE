/**
 * Live flight offers for the agent. Airline websites are JS apps behind bot
 * checks, so this calls Amadeus or Kiwi instead of scraping them.
 *
 * Env: KIWI_API_KEY, or AMADEUS_CLIENT_ID + AMADEUS_CLIENT_SECRET.
 * AMADEUS_ENV=production uses the live host; default is the test host.
 * FLIGHTS_PROVIDER=auto|kiwi|amadeus (auto prefers Amadeus when both are set).
 */

let amadeusToken = { token: null, exp: 0, key: "" };

export function normalizeFlightArgs(args) {
  const origin = String(args.origin || args.from || "")
    .trim()
    .toUpperCase();
  const destination = String(args.destination || args.to || "")
    .trim()
    .toUpperCase();
  const departDate = String(args.departDate || args.date || "").trim();
  const returnDate = args.returnDate ? String(args.returnDate).trim() : null;
  const adults = Math.min(9, Math.max(1, Number(args.adults) || 1));
  const currency = String(args.currency || "CAD")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(origin)) {
    throw new Error("origin must be a 3-letter IATA code");
  }
  if (!/^[A-Z]{3}$/.test(destination)) {
    throw new Error("destination must be a 3-letter IATA code");
  }
  if (origin === destination) throw new Error("origin and destination match");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departDate)) {
    throw new Error("departDate must be YYYY-MM-DD");
  }
  if (returnDate && !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) {
    throw new Error("returnDate must be YYYY-MM-DD");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("currency must be a 3-letter code");
  }
  return { origin, destination, departDate, returnDate, adults, currency };
}

export function flightProvider(env) {
  const choice = String(env.FLIGHTS_PROVIDER || "auto").toLowerCase();
  const kiwi = Boolean(env.KIWI_API_KEY);
  const amadeus = Boolean(env.AMADEUS_CLIENT_ID && env.AMADEUS_CLIENT_SECRET);
  if (choice === "kiwi") return kiwi ? "kiwi" : null;
  if (choice === "amadeus") return amadeus ? "amadeus" : null;
  if (choice !== "auto") return null;
  if (amadeus) return "amadeus";
  if (kiwi) return "kiwi";
  return null;
}

export async function searchFlights(args, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  try {
    const query = normalizeFlightArgs(args || {});
    const provider = flightProvider(env);
    if (!provider) {
      return [
        `Flight lookup ${query.origin} → ${query.destination} on ${query.departDate}: no inventory API is configured.`,
        "Set KIWI_API_KEY, or AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET, on the worker.",
        "Do not invent flight numbers, times, or fares. web_search snippets are not live bookable inventory.",
      ].join("\n");
    }
    const payload =
      provider === "kiwi"
        ? await searchKiwi(query, env, fetchImpl)
        : await searchAmadeus(query, env, fetchImpl);
    return formatOffers(query, provider, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `ERROR: flight lookup failed: ${message}`;
  }
}

function formatOffers(query, provider, payload) {
  const offers = payload.offers || [];
  const header = `Flight lookup via ${provider}: ${query.origin} → ${query.destination} depart ${query.departDate}${
    query.returnDate ? ` return ${query.returnDate}` : ""
  } (${offers.length} offer${offers.length === 1 ? "" : "s"})`;
  if (!offers.length) {
    return `${header}\nNo offers returned. Do not invent itineraries.`;
  }
  const lines = offers.map((offer, index) => {
    const legs = (offer.legs || [])
      .map(
        (leg) =>
          `${leg.flight} ${leg.from}→${leg.to} depart ${leg.depart} arrive ${leg.arrive}`,
      )
      .join("; ");
    const book = offer.bookAt
      ? `Book: ${offer.bookAt}`
      : "Book on the operating airline with this flight number.";
    return `${index + 1}. ${offer.price} ${offer.currency || payload.currency || query.currency} · ${offer.stops} stop(s) · ${legs}\n${book}`;
  });
  return [header, ...lines, payload.note || ""].filter(Boolean).join("\n");
}

function toKiwiDate(iso) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

async function searchKiwi(query, env, fetchImpl) {
  const params = new URLSearchParams({
    fly_from: query.origin,
    fly_to: query.destination,
    date_from: toKiwiDate(query.departDate),
    date_to: toKiwiDate(query.departDate),
    adults: String(query.adults),
    curr: query.currency,
    limit: "6",
    sort: "price",
    flight_type: query.returnDate ? "round" : "oneway",
  });
  if (query.returnDate) {
    params.set("return_from", toKiwiDate(query.returnDate));
    params.set("return_to", toKiwiDate(query.returnDate));
  }
  const res = await fetchImpl(`https://api.tequila.kiwi.com/v2/search?${params}`, {
    headers: { apikey: env.KIWI_API_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Kiwi ${res.status}`);
  return {
    currency: data.currency || query.currency,
    offers: (data.data || []).slice(0, 6).map(mapKiwi),
  };
}

function mapKiwi(item) {
  const route = Array.isArray(item.route) ? item.route : [];
  const outbound = route.filter((seg) => seg.return !== 1);
  return {
    price: item.price,
    currency: null,
    stops: Math.max(0, outbound.length - 1),
    bookAt: item.deep_link || null,
    legs: route.map((seg) => ({
      from: seg.flyFrom,
      to: seg.flyTo,
      flight: `${seg.airline}${seg.flight_no}`,
      depart: seg.local_departure,
      arrive: seg.local_arrival,
    })),
  };
}

function amadeusHost(env) {
  return String(env.AMADEUS_ENV || "test").toLowerCase() === "production"
    ? "api.amadeus.com"
    : "test.api.amadeus.com";
}

async function amadeusAccessToken(env, fetchImpl) {
  const host = amadeusHost(env);
  const key = `${host}:${env.AMADEUS_CLIENT_ID}`;
  if (amadeusToken.token && amadeusToken.key === key && Date.now() < amadeusToken.exp) {
    return amadeusToken.token;
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.AMADEUS_CLIENT_ID,
    client_secret: env.AMADEUS_CLIENT_SECRET,
  });
  const res = await fetchImpl(`https://${host}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error_description || `Amadeus auth ${res.status}`);
  }
  amadeusToken = {
    token: data.access_token,
    exp: Date.now() + Math.max(30, (data.expires_in || 600) - 30) * 1000,
    key,
  };
  return data.access_token;
}

async function searchAmadeus(query, env, fetchImpl) {
  const host = amadeusHost(env);
  const token = await amadeusAccessToken(env, fetchImpl);
  const originDestinations = [
    {
      id: "1",
      originLocationCode: query.origin,
      destinationLocationCode: query.destination,
      departureDateTimeRange: { date: query.departDate },
    },
  ];
  if (query.returnDate) {
    originDestinations.push({
      id: "2",
      originLocationCode: query.destination,
      destinationLocationCode: query.origin,
      departureDateTimeRange: { date: query.returnDate },
    });
  }
  const travelers = Array.from({ length: query.adults }, (_, index) => ({
    id: String(index + 1),
    travelerType: "ADULT",
  }));
  const res = await fetchImpl(`https://${host}/v2/shopping/flight-offers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currencyCode: query.currency,
      originDestinations,
      travelers,
      sources: ["GDS"],
      searchCriteria: { maxFlightOffers: 6 },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  if (!res.ok) {
    const detail = data?.errors?.[0]?.detail || data?.errors?.[0]?.title;
    throw new Error(detail || `Amadeus ${res.status}`);
  }
  return {
    currency: query.currency,
    note: "Book the flight number on the operating airline. Amadeus returns inventory, not a checkout link.",
    offers: (data.data || []).slice(0, 6).map(mapAmadeus),
  };
}

function mapAmadeus(offer) {
  const itineraries = offer.itineraries || [];
  const outbound = itineraries[0]?.segments || [];
  const legs = [];
  for (const itin of itineraries) {
    for (const seg of itin.segments || []) {
      legs.push({
        from: seg.departure?.iataCode,
        to: seg.arrival?.iataCode,
        flight: `${seg.carrierCode}${seg.number}`,
        depart: seg.departure?.at,
        arrive: seg.arrival?.at,
      });
    }
  }
  return {
    price: offer.price?.grandTotal ?? null,
    currency: offer.price?.currency ?? null,
    stops: Math.max(0, outbound.length - 1),
    bookAt: null,
    legs,
  };
}
