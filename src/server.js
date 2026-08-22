require("dotenv").config();
console.log("JWT secret loaded:", !!process.env.JWT_SECRET);

const app = require("./app");
const supabase = require("./config/supabase");

const PORT = process.env.PORT || 5000;

const testSupabaseConnection = async () => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id")
      .limit(1);

    if (error) {
      console.error("Supabase connection error:", error.message);
      return;
    }

    console.log("Supabase connected successfully");
  } catch (error) {
    console.error("Supabase connection failed:", error.message);
  }
};

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await testSupabaseConnection();
});