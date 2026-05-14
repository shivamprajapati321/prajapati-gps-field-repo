```javascript id="vjlwmr"
export default function handler(req, res) {

  try {

    // GET request test
    if (req.method === "GET") {
      return res.status(200).json({
        success: true,
        message: "Callback endpoint working"
      });
    }

    // POST callback request
    if (req.method === "POST") {

      console.log("CALLBACK BODY:");
      console.log(req.body);

      return res.status(200).json({
        success: true,
        received: true
      });
    }

    // Other methods
    return res.status(405).json({
      success: false,
      message: "Method not allowed"
    });

  } catch (error) {

    console.error("ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
```
