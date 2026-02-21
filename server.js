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

// (Keep your existing login, callback & holdings routes here unchanged)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
