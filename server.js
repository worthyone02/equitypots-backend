const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

const API_KEY = process.env.ZERODHA_API_KEY;
const API_SECRET = process.env.ZERODHA_API_SECRET;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Temporary in-memory store (simple MVP solution)
let currentUserId = null;

app.get("/", (req, res) => {
  res.send("Backend Running");
});

// Step 1: Start Zerodha login
app.get("/api/zerodha/login", (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.send("User ID missing");
  }

  currentUserId = user_id;

  const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${API_KEY}`;
  res.redirect(loginUrl);
});

// Step 2: Callback
app.get("/api/zerodha/callback", async (req, res) => {
  const { request_token } = req.query;

  if (!request_token || !currentUserId) {
    return res.send("Missing request_token or user_id");
  }

  try {
    const checksum = crypto
      .createHash("sha256")
      .update(API_KEY + request_token + API_SECRET)
      .digest("hex");

    const response = await axios.post(
      "https://api.kite.trade/session/token",
      new URLSearchParams({
        api_key: API_KEY,
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

    // Save in Supabase
    await supabase
      .from("users_extra")
      .upsert({
        id: currentUserId,
        access_token: access_token,
        broker_connected: true,
      });

    currentUserId = null;

    // Redirect back to frontend dashboard
    res.redirect("https://YOUR-FRONTEND-URL.vercel.app/dashboard");

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("Error generating access token");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
