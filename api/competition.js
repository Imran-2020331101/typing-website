/**
 * KeyFlow — Competition API
 * Vercel Serverless Function (Node.js 18+)
 *
 * Endpoints:
 *   GET  /api/competition?id=XXXX          → competition data + leaderboard
 *   POST /api/competition {action:"create"} → create competition
 *   POST /api/competition {action:"submit"} → submit / update score
 *   POST /api/competition {action:"end"}    → creator ends competition
 *
 * Storage: Upstash Redis via REST API (no npm packages).
 * Env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 */

/* ── Upstash Redis REST helper ──────────────────────────────── */

function makeRedis(url, token) {
  return async function redis(/* ...args */) {
    var args = Array.prototype.slice.call(arguments);
    var response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    var data = await response.json();
    if (data.error) throw new Error(data.error);
    return data.result;
  };
}

/* ── ID generator ───────────────────────────────────────────── */

function generateId(len) {
  var chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var id = "";
  for (var i = 0; i < len; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/* ── Parse HGETALL flat array into sorted leaderboard ───────── */

function parseScores(raw, metric) {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return [];

  var entries = [];
  for (var i = 0; i < raw.length; i += 2) {
    var sid = raw[i];
    try {
      var score = JSON.parse(raw[i + 1]);
      score.sessionId = sid;
      entries.push(score);
    } catch (_) {
      /* skip malformed */
    }
  }

  entries.sort(function (a, b) {
    if (metric === "accuracy") return b.accuracy - a.accuracy || b.wpm - a.wpm;
    return b.wpm - a.wpm || b.accuracy - a.accuracy;
  });

  return entries;
}

/* ── CORS helper ────────────────────────────────────────────── */

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* ── Handler ────────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") return res.status(200).end();

  // Support both Vercel KV naming (KV_REST_API_*) and direct Upstash naming (UPSTASH_REDIS_REST_*)
  var REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  var REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({
      error:
        "Server not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN).",
    });
  }

  var redis = makeRedis(REDIS_URL, REDIS_TOKEN);

  try {
    if (req.method === "GET") {
      return await handleGet(req, res, redis);
    }
    if (req.method === "POST") {
      return await handlePost(req, res, redis);
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Competition API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/* ── GET — fetch competition + leaderboard ──────────────────── */

async function handleGet(req, res, redis) {
  var id = req.query.id;
  if (!id) return res.status(400).json({ error: "Missing competition id" });

  var raw = await redis("GET", "comp:" + id);
  if (!raw) return res.status(404).json({ error: "Competition not found" });

  var comp = JSON.parse(raw);
  comp.expired = Date.now() > comp.deadline;

  var scoresRaw = await redis("HGETALL", "comp:" + id + ":scores");
  var leaderboard = parseScores(scoresRaw, comp.metric);

  return res.status(200).json({ competition: comp, leaderboard: leaderboard });
}

/* ── POST — dispatch by action ──────────────────────────────── */

async function handlePost(req, res, redis) {
  var action = req.body && req.body.action;

  switch (action) {
    case "create":
      return await handleCreate(req, res, redis);
    case "submit":
      return await handleSubmit(req, res, redis);
    case "end":
      return await handleEnd(req, res, redis);
    default:
      return res.status(400).json({ error: "Invalid action" });
  }
}

/* ── CREATE ─────────────────────────────────────────────────── */

async function handleCreate(req, res, redis) {
  var b = req.body;
  var duration = b.duration;
  var metric = b.metric;
  var deadlineHours = b.deadlineHours;
  var creatorSession = b.creatorSession;
  var creatorName = b.creatorName;

  if ([15, 30, 60, 120].indexOf(duration) === -1)
    return res.status(400).json({ error: "Invalid duration" });
  if (["wpm", "accuracy"].indexOf(metric) === -1)
    return res.status(400).json({ error: "Invalid metric" });
  if (!deadlineHours || deadlineHours < 1 || deadlineHours > 24)
    return res.status(400).json({ error: "Invalid deadline" });
  if (!creatorSession)
    return res.status(400).json({ error: "Missing session" });

  var id = generateId(6);
  var deadline = Date.now() + deadlineHours * 3600 * 1000;
  var ttl = Math.ceil(deadlineHours * 3600) + 3600; // +1 h buffer

  var comp = {
    id: id,
    duration: duration,
    metric: metric,
    deadline: deadline,
    creatorSession: creatorSession,
    creatorName: creatorName || "Anonymous",
    ended: false,
    createdAt: Date.now(),
  };

  await redis("SET", "comp:" + id, JSON.stringify(comp), "EX", ttl);

  return res.status(201).json({ id: id, deadline: deadline });
}

/* ── SUBMIT ─────────────────────────────────────────────────── */

async function handleSubmit(req, res, redis) {
  var b = req.body;
  var compId = b.compId;
  var sid = b.sessionId;

  if (!compId || !sid)
    return res.status(400).json({ error: "Missing required fields" });

  var raw = await redis("GET", "comp:" + compId);
  if (!raw) return res.status(404).json({ error: "Competition not found" });

  var comp = JSON.parse(raw);
  var ended = comp.ended || Date.now() > comp.deadline;

  if (ended) {
    var scoresRaw = await redis("HGETALL", "comp:" + compId + ":scores");
    return res.status(200).json({
      updated: false,
      ended: true,
      leaderboard: parseScores(scoresRaw, comp.metric),
    });
  }

  // Check existing best
  var existingRaw = await redis("HGET", "comp:" + compId + ":scores", sid);
  var shouldUpdate = true;

  if (existingRaw) {
    var existing = JSON.parse(existingRaw);
    if (comp.metric === "wpm" && existing.wpm >= b.wpm) shouldUpdate = false;
    if (comp.metric === "accuracy" && existing.accuracy >= b.accuracy)
      shouldUpdate = false;
  }

  if (shouldUpdate) {
    var score = {
      name: b.name || "Anonymous",
      wpm: b.wpm,
      accuracy: b.accuracy,
      errors: b.errors,
      chars: b.chars,
      timestamp: Date.now(),
    };
    await redis(
      "HSET",
      "comp:" + compId + ":scores",
      sid,
      JSON.stringify(score)
    );
    // Set TTL on scores hash to match competition
    var remainTtl = Math.max(
      1,
      Math.ceil((comp.deadline - Date.now()) / 1000) + 3600
    );
    await redis("EXPIRE", "comp:" + compId + ":scores", remainTtl);
  }

  var allScores = await redis("HGETALL", "comp:" + compId + ":scores");
  var leaderboard = parseScores(allScores, comp.metric);
  var yourRank =
    leaderboard.findIndex(function (s) {
      return s.sessionId === sid;
    }) + 1;

  return res.status(200).json({
    updated: shouldUpdate,
    leaderboard: leaderboard,
    yourRank: yourRank,
  });
}

/* ── END ────────────────────────────────────────────────────── */

async function handleEnd(req, res, redis) {
  var compId = req.body.compId;
  var sid = req.body.sessionId;

  if (!compId || !sid)
    return res.status(400).json({ error: "Missing required fields" });

  var raw = await redis("GET", "comp:" + compId);
  if (!raw) return res.status(404).json({ error: "Competition not found" });

  var comp = JSON.parse(raw);
  if (comp.creatorSession !== sid)
    return res
      .status(403)
      .json({ error: "Only the creator can end the competition" });

  comp.ended = true;
  var ttl = await redis("TTL", "comp:" + compId);
  await redis(
    "SET",
    "comp:" + compId,
    JSON.stringify(comp),
    "EX",
    Math.max(ttl, 3600)
  );

  return res.status(200).json({ success: true });
}
