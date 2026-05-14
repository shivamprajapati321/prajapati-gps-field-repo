```javascript
module.exports = async function handler(req, res) {
  try {

    console.log("METHOD:", req.method);

    // Browser test
    if (req.method === "GET") {
      return res.status(200).json({
        success: true,
        message: "Callback endpoint working"
      });
    }

    // Allow only POST for API callback
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        message: "Method not allowed"
      });
    }

    console.log("BODY:", req.body);

    // Callback data from Unifers
    const data = req.body || {};

    // Print callback data in Vercel logs
    console.log(
      "CALLBACK RECEIVED:",
      JSON.stringify(data, null, 2)
    );

    // Success response
    return res.status(200).json({
      success: true,
      received: true,
      data: data
    });

  } catch (err) {

    console.error("CALLBACK ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
```
