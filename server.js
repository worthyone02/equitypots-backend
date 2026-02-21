const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

let currentUserId = null;

/* =============================
   ROOT
============================= */
app.get("/", (req, res) => {
  res.send("Backend Running");
});

/* =============================
   SMALLCASE — CREATE (Admin)
============================= */
app.post("/api/smallcases", async (req, res) => {
  const { name, sheet_url, user_id } = req.body;

  // Check admin
  const { data: user } = await supabase
    .from("users_extra")
    .select("role")
    .eq("id", user_id)
    .single();

  if (user?.role !== "admin") {
    return res.status(403).send("Not authorized");
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

  if (error) return res.status(500).send(error.message);

  res.json(data);
});

/* =============================
   SMALLCASE — GRANT ACCESS
============================= */
app.post("/api/grant-access", async (req, res) => {
  const { smallcase_id, user_email } = req.body;

  // Find user by email
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const user = authUsers.users.find(
    (u) => u.email === user_email
  );

  if (!user) return res.status(404).send("User not found");

  await supabase.from("smallcase_access").insert({
    smallcase_id,
    user_id: user.id,
  });

  res.send("Access granted");
});

/* =============================
   SMALLCASE — LIST FOR USER
============================= */
app.get("/api/smallcases", async (req, res) => {
  const { user_id } = req.query;

  const { data } = await supabase
    .from("smallcase_access")
    .select("smallcases(*)")
    .eq("user_id", user_id);

  res.json(data.map((d) => d.smallcases));
});

/* =============================
   SMALLCASE — GET SHEET DATA
============================= */
app.get("/api/smallcase-data", async (req, res) => {
  const { smallcase_id } = req.query;

  const { data } = await supabase
    .from("smallcases")
    .select("sheet_url")
    .eq("id", smallcase_id)
    .single();

  if (!data?.sheet_url)
    return res.status(404).send("Sheet not found");

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

    res.json(portfolio);

  } catch (error) {
    res.status(500).send("Sheet parsing error");
  }
});

/* =============================
   ZERODHA LOGIN + HOLDINGS
============================= */

/* =============================
   ZERODHA — FETCH HOLDINGS
============================= */
app.get("/api/zerodha/holdings", async (req, res) => {
  const { user_id } = req.query;

  console.log("==== HOLDINGS ROUTE HIT ====");
  console.log("Received user_id:", user_id);

  if (!user_id) {
    return res.status(400).send("User ID required");
  }

  try {
    // 1️⃣ Fetch API key + access token from Supabase
    const { data: userData, error } = await supabase
      .from("users_extra")
      .select("api_key, access_token")
      .eq("id", user_id)
      .single();

    console.log("User data from DB:", userData);
    console.log("DB error:", error);

    if (!userData?.api_key || !userData?.access_token) {
      return res.status(400).send("API key or access token missing");
    }

    // 2️⃣ Call Zerodha Holdings API
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

    console.log("Zerodha holdings response:", response.data);

    // 3️⃣ Return holdings array
    res.json(response.data.data);

  } catch (error) {
    console.log("========== HOLDINGS ERROR ==========");
    console.log("Full error:", error);
    console.log("Response data:", error.response?.data);
    console.log("Status:", error.response?.status);
    console.log("Message:", error.message);
    console.log("====================================");

    res.status(500).send("Error fetching holdings");
  }
});
/* =============================
   ZERODHA — LOGIN
============================= */
app.get("/api/zerodha/login", async (req, res) => {
  const { user_id } = req.query;

  console.log("LOGIN ROUTE HIT");
  console.log("User ID:", user_id);

  if (!user_id) {
    return res.send("User ID missing");
  }

  currentUserId = user_id;

  const { data: userData, error } = await supabase
    .from("users_extra")
    .select("api_key")
    .eq("id", user_id)
    .single();

  console.log("User data:", userData);
  console.log("DB error:", error);

  if (!userData?.api_key) {
    return res.send("API key not found");
  }

  const loginUrl =
    `https://kite.zerodha.com/connect/login?v=3&api_key=${userData.api_key}`;

  console.log("Redirecting to:", loginUrl);

  res.redirect(loginUrl);
});
/* =============================
   ZERODHA — CALLBACK
============================= */
app.get("/api/zerodha/callback", async (req, res) => {
  const { request_token } = req.query;

  console.log("CALLBACK HIT");
  console.log("Request token:", request_token);
  console.log("Current user ID:", currentUserId);

  if (!request_token || !currentUserId) {
    return res.send("Missing request_token or user");
  }

  try {
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

    const response = await axios.post(
      "https://api.kite.trade/session/token",
      new URLSearchParams({
        api_key: userData.api_key,
        request_token: request_token,
        checksum: checksum,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const access_token =
      response.data.data.access_token;

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
    console.log("Callback error:",
      error.response?.data || error.message
    );
    res.send("Error generating access token");
  }
});
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
