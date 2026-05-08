import express from "express";
import { uploadRouter } from "./upload";
import { healthRouter } from "./health";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use("/api", uploadRouter);
app.use("/api", healthRouter);

app.listen(PORT, () => {
  console.log(`Upload service running on port ${PORT}`);
});

export default app;
