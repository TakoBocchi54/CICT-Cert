import "dotenv/config";
import app from "./app.js";
import { startAutoIssue } from "./services/autoIssue.js";

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
startAutoIssue();