const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");

const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

let currentUserId = null;

app.get("/", (req, res) => {
  res.send("Backend Running");
});

/* ==============================
   STEP 1 — LOGIN ROUTE
============================== */
app.get("/api/zerodha/login", async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.send("User ID missing");
  }

  currentUserId = user_id;

  const { data: userData } = await supabase
    .from("users_extra")
    .select("*")
    .eq("id", user_id)
    .maybeSingle();

  if (!userData?.api_key) {
    return res.send("User API Key not found. Save API keys first.");
  }

  const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${userData.api_key}`;
  res.redirect(loginUrl);
});

/* ==============================
   STEP 2 — CALLBACK
============================== */
app.get("/api/zerodha/callback", async (req, res) => {
  const { request_token } = req.query;

  if (!request_token || !currentUserId) {
    return res.send("Missing request_token or user_id");
  }

  try {
    const { data: userData } = await supabase
      .from("users_extra")
      .select("*")
      .eq("id", currentUserId)
      .maybeSingle();

    if (!userData?.api_key || !userData?.api_secret) {
      return res.send("API Key or Secret missing for user.");
    }

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

    const access_token = response.data.data.access_token;

    await supabase
      .from("users_extra")
      .update({
        access_token: access_token,
        broker_connected: true,
      })
      .eq("id", currentUserId);

    currentUserId = null;

    res.redirect('https://nextjs-boilerplate-ashy-gamma-18.vercel.app/dashboard");

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("Error generating access token");
  }
});

/* ==============================
   STEP 3 — FETCH HOLDINGS
============================== */
app.get("/api/zerodha/holdings", async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).send("User ID required");
  }

  const { data: userData } = await supabase
    .from("users_extra")
    .select("api_key, access_token")
    .eq("id", user_id)
    .maybeSingle();

  if (!userData?.access_token) {
    return res.status(400).send("Access token not found. Connect broker.");
  }

  try {
    const response = await axios.get(
      "https://api.kite.trade/portfolio/holdings",
      {
        headers: {
          "X-Kite-Version": "3",
          Authorization:
            "token " + userData.api_key + ":" + userData.access_token,
        },
      }
    );

    res.json(response.data.data);

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("Error fetching holdings");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
