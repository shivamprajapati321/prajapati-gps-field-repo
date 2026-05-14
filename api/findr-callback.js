```javascript
export default async function handler(req, res) {
  try {
    console.log("METHOD:", req.method);
    console.log("BODY:", req.body);

    // Only POST allowed
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        message: "Method not allowed"
      });
    }

    // Callback data from Unifers
    const data = req.body;

    // IMPORTANT:
    // Yahan DB / Supabase / KV / File save kar sakte ho

    console.log("CALLBACK RECEIVED:", JSON.stringify(data, null, 2));

    return res.status(200).json({
      success: true,
      received: true
    });

  } catch (err) {
    console.error("CALLBACK ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
```
