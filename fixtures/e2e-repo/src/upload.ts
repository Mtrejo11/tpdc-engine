import { Router, Request, Response } from "express";

export const uploadRouter = Router();

uploadRouter.post("/upload", (req: Request, res: Response) => {
  const { filename, data } = req.body;

  if (!filename || !data) {
    res.status(400).json({ error: "Missing filename or data" });
    return;
  }

  // Simulate saving the file
  const id = `file_${Date.now()}`;
  console.log(`Saved file: ${filename} as ${id}`);

  res.status(201).json({ id, filename, size: data.length });
});

uploadRouter.get("/uploads", (_req: Request, res: Response) => {
  // Placeholder: return empty list
  res.json({ uploads: [] });
});
