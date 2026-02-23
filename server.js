
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

/* =============================
   SUPABASE
============================= */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* =============================
   ROOT
============================= */

app.get("/", (req, res) => {
  res.send("Backend Running");
});

/* =============================
   ADMIN — LIST ALL SMALLCASES
============================= */

app.get("/api/admin/smallcases", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("smallcases")
      .select("*");

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

/* =============================
   ADMIN — CREATE SMALLCASE
============================= */

app.post("/api/admin/smallcases", async (req, res) => {
  const { name, sheet_url, user_id } = req.body;

  if (!name || !sheet_url || !user_id) {
    return res.status(400).json({ error: "Missing data" });
  }

  const { data: adminUser } = await supabase
    .from("users_extra")
    .select("role")
    .eq("id", user_id)
    .single();

  if (adminUser?.role !== "admin") {
    return res.status(403).json({ error: "Not authorized" });
  }

  const { data, error } = await supabase
    .from("smallcases")
    .insert({
      name,
      sheet_url,
      created_by: user_id,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

/* =============================
   ADMIN — GRANT ACCESS
============================= */

app.post("/api/admin/grant-access", async (req, res) => {
  const { smallcase_id, user_email } = req.body;

  if (!smallcase_id || !user_email) {
    return res.status(400).json({ error: "Missing data" });
  }

  const { data: authUsers } = await supabase.auth.admin.listUsers();

  const user = authUsers.users.find(
    (u) => u.email === user_email
  );

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  await supabase.from("smallcase_access").insert({
    smallcase_id,
    user_id: user.id,
  });

  return res.json({ success: true });
});

/* =============================
   USER — LIST ASSIGNED SMALLCASES
============================= */

app.get("/api/smallcases", async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: "User ID required" });
  }

  const { data, error } = await supabase
    .from("smallcase_access")
    .select("smallcases(*)")
    .eq("user_id", user_id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json((data || []).map((d) => d.smallcases));
});

/* =============================
   SMALLCASE — SHEET DATA
============================= */

app.get("/api/smallcase-data", async (req, res) => {
  const { smallcase_id } = req.query;

  const { data } = await supabase
    .from("smallcases")
    .select("sheet_url")
    .eq("id", smallcase_id)
    .single();

  if (!data?.sheet_url) {
    return res.status(404).json({ error: "Sheet not found" });
  }

  try {
    const response = await axios.get(
      data.sheet_url.replace(
        "/edit",
        "/gviz/tq?tqx=out:json"
      )
    );

    const text = response.data;
    const json = JSON.parse(
      text.substring(47).slice(0, -2)
    );

    const rows = json.table.rows.slice(4);

    const portfolio = rows.map((row) => ({
      name: row.c[0]?.v,
      nse: row.c[1]?.v,
      weight: parseFloat(row.c[2]?.v),
    }));

    return res.json(portfolio);

  } catch (error) {
    return res.status(500).json({ error: "Sheet parsing error" });
  }
});

/* =============================
   ZERODHA — HOLDINGS
============================= */

app.get("/api/zerodha/holdings", async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: "User ID required" });
  }

  const { data: userData, error } = await supabase
    .from("users_extra")
    .select("api_key, access_token, broker_connected")
    .eq("id", user_id)
    .single();

  if (error || !userData) {
    return res.status(404).json({ error: "User not found" });
  }

  if (!userData.api_key || !userData.access_token) {
    return res.status(401).json({ error: "Reauthorize required" });
  }

  try {
    const response = await axios.get(
      "https://api.kite.trade/portfolio/holdings",
      {
        headers: {
          "X-Kite-Version": "3",
          Authorization:
            "token " +
            userData.api_key +
            ":" +
            userData.access_token,
        },
      }
    );

    return res.json(response.data.data);

  } catch (error) {
    if (
      error.response?.data?.error_type === "TokenException" ||
      error.response?.status === 403
    ) {
      await supabase
        .from("users_extra")
        .update({
          broker_connected: false,
          access_token: null,
        })
        .eq("id", user_id);

      return res.status(401).json({
        error: "Session expired. Reauthorize broker.",
      });
    }

    return res.status(500).json({ error: "Holdings fetch failed" });
  }
});

/* =============================
   ZERODHA — LOGIN
============================= */

let currentUserId = null;

app.get("/api/zerodha/login", async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) return res.send("User ID missing");

  currentUserId = user_id;

  const { data: userData } = await supabase
    .from("users_extra")
    .select("api_key")
    .eq("id", user_id)
    .single();

  if (!userData?.api_key) {
    return res.send("API key not found");
  }

  const loginUrl =
    `https://kite.zerodha.com/connect/login?v=3&api_key=${userData.api_key}`;

  res.redirect(loginUrl);
});

/* =============================
   ZERODHA — CALLBACK
============================= */

app.get("/api/zerodha/callback", async (req, res) => {
  const { request_token } = req.query;

  if (!request_token || !currentUserId) {
    return res.send("Invalid callback");
  }

  const { data: userData } = await supabase
    .from("users_extra")
    .select("api_key, api_secret")
    .eq("id", currentUserId)
    .single();

  const checksum = crypto
    .createHash("sha256")
    .update(
      userData.api_key +
      request_token +
      userData.api_secret
    )
    .digest("hex");

  try {
    const response = await axios.post(
      "https://api.kite.trade/session/token",
      new URLSearchParams({
        api_key: userData.api_key,
        request_token,
        checksum,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const access_token = response.data.data.access_token;

    await supabase
      .from("users_extra")
      .update({
        access_token,
        broker_connected: true,
      })
      .eq("id", currentUserId);

    currentUserId = null;

    res.redirect(
      "https://nextjs-boilerplate-ashy-gamma-18.vercel.app/dashboard"
    );

  } catch (error) {
    res.send("Access token generation failed");
  }
});

/* =============================
   START SERVER
============================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
